'use strict';
const { db } = require('podam/db');
const { newId } = require('podam/auth');
const W = require('./works');

/**
 * 읽어 낸 원문 조각을 넣고 꺼내는 곳.
 *
 * 조각은 **브라우저가 모델에게 받아 온 것**이다 (키가 브라우저에만 있으므로).
 * 서버는 그것을 다듬어 담고, 나중에 질문에 맞는 것을 골라 준다.
 */
const MAX_CHUNK = 4000;                // 조각 하나의 글자 수
const MAX_PER_DOC = 600;               // 자료 하나가 만들 수 있는 조각 수
const MIN_CHUNK = 2;                   // 이보다 짧으면 버린다 (빈 쪽)

const view = (c) => ({
  id: c.id, docId: c.doc_id, idx: c.idx,
  page: c.page || null, heading: c.heading || '', text: c.text,
  docName: c.doc_name || undefined,
});

/**
 * 한 자료의 조각을 통째로 갈아 끼운다.
 * 다시 분석해도 옛 조각이 남아 두 번 세지 않게 **먼저 지우고 넣는다.**
 */
function ingest(roomId, docId, pages) {
  const d = W.getDoc(roomId, docId);
  if (!d) return { error: '없는 자료입니다' };

  const rows = [];
  for (const p of Array.isArray(pages) ? pages : []) {
    const text = String(p?.text == null ? '' : p.text).trim().slice(0, MAX_CHUNK);
    if (text.length < MIN_CHUNK) continue;            // 빈 쪽은 담지 않는다
    const page = Number(p?.page);
    rows.push({
      id: newId(), room_id: roomId, work_id: d.work_id, doc_id: docId,
      idx: rows.length,
      page: Number.isFinite(page) && page > 0 ? Math.min(9999, Math.round(page)) : null,
      heading: W.clip(p?.heading, 120) || null,
      text,
    });
    if (rows.length >= MAX_PER_DOC) break;
  }
  if (!rows.length) return { error: '읽어 낸 내용이 없습니다' };

  const chars = rows.reduce((n, r) => n + r.text.length, 0);
  const pageNums = rows.map((r) => r.page).filter(Boolean);
  const ins = db.prepare(`INSERT INTO ai_chunks (id, room_id, work_id, doc_id, idx, page, heading, text)
                          VALUES (@id, @room_id, @work_id, @doc_id, @idx, @page, @heading, @text)`);
  db.transaction(() => {
    db.prepare('DELETE FROM ai_chunks WHERE doc_id = ? AND room_id = ?').run(docId, roomId);
    for (const r of rows) ins.run(r);
    db.prepare('UPDATE ai_docs SET status = \'done\', error = NULL, pages = ?, chars = ?, done_at = ? WHERE id = ?')
      .run(pageNums.length ? Math.max(...pageNums) : rows.length, chars, Date.now(), docId);
    db.prepare('UPDATE ai_works SET updated_at = ? WHERE id = ?').run(Date.now(), d.work_id);
  })();

  return { ok: true, count: rows.length, doc: W.docView(W.getDoc(roomId, docId)) };
}

/** 한 작품의 조각 전부 (검색·내보내기가 쓴다). 자료 이름을 붙여 돌려준다. */
function all(roomId, workId) {
  return db.prepare(`SELECT c.*, d.name AS doc_name FROM ai_chunks c
                     JOIN ai_docs d ON d.id = c.doc_id
                     WHERE c.room_id = ? AND c.work_id = ?
                     ORDER BY COALESCE(d.sort_order, 999999), d.created_at, c.idx`)
    .all(roomId, workId).map(view);
}

function byIds(roomId, ids) {
  const want = (Array.isArray(ids) ? ids : []).slice(0, 50);
  if (!want.length) return [];
  const rows = db.prepare(`SELECT c.*, d.name AS doc_name FROM ai_chunks c
                           JOIN ai_docs d ON d.id = c.doc_id
                           WHERE c.room_id = ? AND c.id IN (${want.map(() => '?').join(',')})`)
    .all(roomId, ...want);
  return rows.map(view);
}

// ── 문답 기록 ────────────────────────────────────────────────────────────────

const askView = (a) => ({
  id: a.id, workId: a.work_id, nickname: a.nickname || '',
  question: a.question, answer: a.answer || '',
  cites: (() => { try { return JSON.parse(a.cites || '[]'); } catch { return []; } })(),
  model: a.model || '', ok: !!a.ok, createdAt: a.created_at,
});

function log(roomId, workId, gm, { question, answer, cites, model, ok }) {
  const row = {
    id: newId(), room_id: roomId, work_id: workId,
    gm_id: gm?.id || null, nickname: W.clip(gm?.nickname, 30) || null,
    question: W.clip(question, 1000), answer: W.clip(answer, 20000),
    cites: JSON.stringify((Array.isArray(cites) ? cites : []).slice(0, 20)),
    model: W.clip(model, 60) || null, ok: ok === false ? 0 : 1,
    created_at: Date.now(),
  };
  if (!row.question) return { error: '질문이 없습니다' };
  db.prepare(`INSERT INTO ai_asks (id, room_id, work_id, gm_id, nickname, question, answer, cites, model, ok, created_at)
              VALUES (@id, @room_id, @work_id, @gm_id, @nickname, @question, @answer, @cites, @model, @ok, @created_at)`)
    .run(row);
  // 기록이 한없이 쌓이지 않게 작품마다 최근 200개만 남긴다.
  db.prepare(`DELETE FROM ai_asks WHERE work_id = ? AND id NOT IN
              (SELECT id FROM ai_asks WHERE work_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 200)`)
    .run(workId, workId);
  return { ok: true, ask: askView(row) };
}

function asks(roomId, workId, limit = 50) {
  return db.prepare(`SELECT * FROM ai_asks WHERE room_id = ? AND work_id = ?
                     ORDER BY created_at DESC, rowid DESC LIMIT ?`)
    .all(roomId, workId, Math.min(200, Math.max(1, Number(limit) || 50)))
    .map(askView).reverse();
}

module.exports = { MAX_CHUNK, MAX_PER_DOC, ingest, all, byIds, log, asks, askView };
