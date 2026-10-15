'use strict';
const { db } = require('podam/db');
const { newId } = require('podam/auth');

/**
 * 작품과 자료 목록.
 *
 * 모든 조회는 **room_id 를 함께 건다.** 작품 id 를 알아도 남의 방 것은 열리지 않는다.
 */
const MAX_WORKS = 20;                  // 한 방에 둘 수 있는 작품 수
const MAX_DOCS = 300;                  // 한 작품에 담을 자료 수

const clip = (s, n) => String(s == null ? '' : s).trim().slice(0, n);

const workView = (w) => ({
  id: w.id,
  name: w.name,
  note: w.note || '',
  docs: w.docs || 0,
  chunks: w.chunks || 0,
  createdAt: w.created_at,
  updatedAt: w.updated_at,
});

const docView = (d) => ({
  id: d.id,
  workId: d.work_id,
  fileId: d.file_id || null,
  name: d.name,
  path: d.path || '',
  mime: d.mime || '',
  bytes: d.bytes || 0,
  pages: d.pages || 0,
  chars: d.chars || 0,
  status: d.status,
  error: d.error || '',
  createdAt: d.created_at,
  doneAt: d.done_at || null,
});

/** 작품 목록. 자료·조각 수를 함께 세어 목록에서 바로 보이게 한다. */
function list(roomId) {
  return db.prepare(`
    SELECT w.*,
      (SELECT COUNT(*) FROM ai_docs   d WHERE d.work_id = w.id) AS docs,
      (SELECT COUNT(*) FROM ai_chunks c WHERE c.work_id = w.id) AS chunks
    FROM ai_works w WHERE w.room_id = ? ORDER BY w.created_at DESC`).all(roomId).map(workView);
}

/** 이 방의 작품인지 확인하며 가져온다. */
function get(roomId, workId) {
  return db.prepare('SELECT * FROM ai_works WHERE id = ? AND room_id = ?').get(workId, roomId) || null;
}

function create(roomId, name, note) {
  const n = db.prepare('SELECT COUNT(*) c FROM ai_works WHERE room_id = ?').get(roomId).c;
  if (n >= MAX_WORKS) return { error: `작품은 ${MAX_WORKS}개까지 둘 수 있습니다` };
  const now = Date.now();
  const row = {
    id: newId(), room_id: roomId,
    name: clip(name, 40) || '새 작품', note: clip(note, 500) || null,
    created_at: now, updated_at: now,
  };
  db.prepare(`INSERT INTO ai_works (id, room_id, name, note, created_at, updated_at)
              VALUES (@id, @room_id, @name, @note, @created_at, @updated_at)`).run(row);
  return { ok: true, work: workView({ ...row, docs: 0, chunks: 0 }) };
}

function rename(roomId, workId, name, note) {
  const w = get(roomId, workId);
  if (!w) return { error: '없는 작품입니다' };
  db.prepare('UPDATE ai_works SET name = ?, note = ?, updated_at = ? WHERE id = ?')
    .run(clip(name, 40) || w.name, note === undefined ? w.note : (clip(note, 500) || null), Date.now(), workId);
  return { ok: true };
}

/** 작품을 지우면 자료·조각·문답이 함께 사라진다. 원본 파일은 자료함 정리에 맡긴다. */
function remove(roomId, workId) {
  const w = get(roomId, workId);
  if (!w) return { error: '없는 작품입니다' };
  db.transaction(() => {
    db.prepare('DELETE FROM ai_chunks WHERE work_id = ? AND room_id = ?').run(workId, roomId);
    db.prepare('DELETE FROM ai_docs   WHERE work_id = ? AND room_id = ?').run(workId, roomId);
    db.prepare('DELETE FROM ai_asks   WHERE work_id = ? AND room_id = ?').run(workId, roomId);
    db.prepare('DELETE FROM ai_works  WHERE id = ? AND room_id = ?').run(workId, roomId);
  })();
  return { ok: true };
}

function docs(roomId, workId) {
  return db.prepare(`SELECT * FROM ai_docs WHERE room_id = ? AND work_id = ?
                     ORDER BY COALESCE(sort_order, 999999), created_at, rowid`)
    .all(roomId, workId).map(docView);
}

function getDoc(roomId, docId) {
  return db.prepare('SELECT * FROM ai_docs WHERE id = ? AND room_id = ?').get(docId, roomId) || null;
}

/** 파일을 올린 직후 자료 한 줄을 만든다 (아직 읽지 않은 상태). */
function addDoc(roomId, workId, { fileId, name, path, mime, bytes }) {
  const n = db.prepare('SELECT COUNT(*) c FROM ai_docs WHERE work_id = ?').get(workId).c;
  if (n >= MAX_DOCS) return { error: `자료는 한 작품에 ${MAX_DOCS}개까지 넣을 수 있습니다` };
  const row = {
    id: newId(), room_id: roomId, work_id: workId,
    file_id: fileId || null, name: clip(name, 200) || '이름 없음',
    path: clip(path, 300) || null, mime: mime || null, bytes: bytes || 0,
    pages: 0, chars: 0, status: 'wait', error: null,
    sort_order: n, created_at: Date.now(), done_at: null,
  };
  db.prepare(`INSERT INTO ai_docs (id, room_id, work_id, file_id, name, path, mime, bytes,
                pages, chars, status, error, sort_order, created_at, done_at)
              VALUES (@id, @room_id, @work_id, @file_id, @name, @path, @mime, @bytes,
                @pages, @chars, @status, @error, @sort_order, @created_at, @done_at)`).run(row);
  return { ok: true, doc: docView(row) };
}

/** 읽는 중 · 실패 · 되돌리기. 완료는 chunks.ingest 가 맡는다. */
function setStatus(roomId, docId, status, error) {
  const d = getDoc(roomId, docId);
  if (!d) return { error: '없는 자료입니다' };
  if (!['wait', 'busy', 'fail'].includes(status)) return { error: '알 수 없는 상태입니다' };
  db.prepare('UPDATE ai_docs SET status = ?, error = ? WHERE id = ?')
    .run(status, status === 'fail' ? clip(error, 300) : null, docId);
  return { ok: true, doc: docView(getDoc(roomId, docId)) };
}

function removeDoc(roomId, docId) {
  const d = getDoc(roomId, docId);
  if (!d) return { error: '없는 자료입니다' };
  db.transaction(() => {
    db.prepare('DELETE FROM ai_chunks WHERE doc_id = ? AND room_id = ?').run(docId, roomId);
    db.prepare('DELETE FROM ai_docs WHERE id = ? AND room_id = ?').run(docId, roomId);
  })();
  return { ok: true };
}

function reorder(roomId, workId, ids) {
  const mine = new Set(docs(roomId, workId).map((d) => d.id));
  const upd = db.prepare('UPDATE ai_docs SET sort_order = ? WHERE id = ? AND room_id = ?');
  db.transaction(() => {
    (Array.isArray(ids) ? ids : []).forEach((id, i) => { if (mine.has(id)) upd.run(i, id, roomId); });
  })();
  return { ok: true };
}

module.exports = {
  MAX_WORKS, MAX_DOCS, clip, workView, docView,
  list, get, create, rename, remove,
  docs, getDoc, addDoc, setStatus, removeDoc, reorder,
};
