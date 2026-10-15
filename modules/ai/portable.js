'use strict';
const { db } = require('podam/db');
const { newId } = require('podam/auth');
const W = require('./works');
const C = require('./chunks');

/**
 * 분석 결과 내보내기 / 불러오기.
 *
 * 같은 작품을 다음 판에서 또 할 때 **다시 읽히지 않으려고** 만든 길이다.
 * 담는 것은 읽어 낸 글(조각)뿐이고 **원본 파일 바이트는 담지 않는다** —
 * 문답에는 조각만 있으면 되고, 파일까지 넣으면 수백 MB가 되기 때문이다.
 * 원본까지 옮기고 싶으면 룸 셋팅(zip)을 쓴다.
 */
const FORMAT = 'mm-ai';
const VERSION = 1;
const MAX_DOCS = 300;
const MAX_CHUNKS = 20000;

/** 지금 작품을 한 덩어리로 만든다. */
function collectWork(roomId, workId) {
  const w = W.get(roomId, workId);
  if (!w) return null;
  const docs = W.docs(roomId, workId);
  const order = new Map(docs.map((d, i) => [d.id, i]));
  const chunks = C.all(roomId, workId)
    .filter((c) => order.has(c.docId))
    .map((c) => ({ doc: order.get(c.docId), idx: c.idx, page: c.page, heading: c.heading, text: c.text }));

  return {
    format: FORMAT,
    version: VERSION,
    exportedAt: Date.now(),
    work: { name: w.name, note: w.note || '' },
    docs: docs.map((d) => ({
      name: d.name, path: d.path, mime: d.mime, bytes: d.bytes,
      pages: d.pages, chars: d.chars, fileId: d.fileId || null,
    })),
    chunks,
  };
}

/** 밖에서 들어온 것을 믿지 않고 다듬는다. 형식이 아니면 null. */
function read(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.format !== FORMAT) return null;

  const docs = (Array.isArray(raw.docs) ? raw.docs : []).slice(0, MAX_DOCS).map((d) => ({
    name: W.clip(d?.name, 200) || '이름 없음',
    path: W.clip(d?.path, 300),
    mime: W.clip(d?.mime, 100),
    bytes: Number(d?.bytes) || 0,
    fileId: d?.fileId ? W.clip(d.fileId, 40) : null,
  }));
  if (!docs.length) return null;

  const chunks = (Array.isArray(raw.chunks) ? raw.chunks : []).slice(0, MAX_CHUNKS).map((c) => ({
    doc: Number(c?.doc) || 0,
    page: Number(c?.page) > 0 ? Math.round(Number(c.page)) : null,
    heading: W.clip(c?.heading, 120),
    text: String(c?.text == null ? '' : c.text).trim().slice(0, C.MAX_CHUNK),
  })).filter((c) => c.text && c.doc >= 0 && c.doc < docs.length);

  return {
    work: {
      name: W.clip(raw.work?.name, 40) || '불러온 작품',
      note: W.clip(raw.work?.note, 500),
    },
    docs,
    chunks,
  };
}

/**
 * 다듬은 것을 방에 심는다. 언제나 **새 작품**으로 들어간다.
 * @param fileMap 룸 셋팅으로 들어올 때 원본 파일 id 를 새 id 로 바꾸는 표 (없으면 원본 없음)
 */
function apply(roomId, data, { fileMap } = {}) {
  if (!data) return { error: '형식이 아닙니다' };
  const made = W.create(roomId, data.work.name, data.work.note);
  if (made.error) return made;
  const workId = made.work.id;

  const docIds = [];
  const now = Date.now();
  const insDoc = db.prepare(`INSERT INTO ai_docs (id, room_id, work_id, file_id, name, path, mime, bytes,
      pages, chars, status, error, sort_order, created_at, done_at)
    VALUES (@id, @room_id, @work_id, @file_id, @name, @path, @mime, @bytes,
      @pages, @chars, 'done', NULL, @sort_order, @created_at, @done_at)`);
  const insChunk = db.prepare(`INSERT INTO ai_chunks (id, room_id, work_id, doc_id, idx, page, heading, text)
    VALUES (@id, @room_id, @work_id, @doc_id, @idx, @page, @heading, @text)`);

  db.transaction(() => {
    data.docs.forEach((d, i) => {
      const id = newId();
      docIds.push(id);
      // 원본 파일은 룸 셋팅으로 함께 왔을 때만 붙는다. 없으면 「다시 읽기」만 막힌다.
      const mapped = d.fileId && fileMap ? fileMap.get(d.fileId) : null;
      insDoc.run({
        id, room_id: roomId, work_id: workId, file_id: mapped || null,
        name: d.name, path: d.path || null, mime: d.mime || null, bytes: d.bytes,
        pages: 0, chars: 0, sort_order: i, created_at: now, done_at: now,
      });
    });

    const per = new Map();                       // 자료마다 0부터 번호를 다시 매긴다
    const stat = new Map();
    for (const c of data.chunks) {
      const docId = docIds[c.doc];
      if (!docId) continue;
      const idx = per.get(docId) || 0;
      per.set(docId, idx + 1);
      if (idx >= C.MAX_PER_DOC) continue;
      insChunk.run({
        id: newId(), room_id: roomId, work_id: workId, doc_id: docId, idx,
        page: c.page, heading: c.heading || null, text: c.text,
      });
      const s = stat.get(docId) || { chars: 0, pages: 0 };
      s.chars += c.text.length;
      s.pages = Math.max(s.pages, c.page || idx + 1);
      stat.set(docId, s);
    }
    const upd = db.prepare('UPDATE ai_docs SET pages = ?, chars = ? WHERE id = ?');
    for (const [docId, s] of stat) upd.run(s.pages, s.chars, docId);
  })();

  return { ok: true, workId, docs: docIds.length, chunks: data.chunks.length };
}

module.exports = { FORMAT, VERSION, collectWork, read, apply };
