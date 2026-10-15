'use strict';
const { db } = require('podam/db');
const { newId } = require('podam/auth');

/**
 * GM이 미리 등록해 두는 무대 자료 — 배경 그림·BGM·따로 띄울 그림.
 *
 * 파일 자체는 기존 자료함(`files`, is_preset=1)에 그대로 둔다. 여기에는 '무대에서 쓸
 * 목록'만 담는다. 그래야 룸 셋팅(zip)에 파일이 자동으로 실리고, 지우는 길도 하나로 남는다.
 */

const KINDS = new Set(['bg', 'bgm', 'ov']);

const view = (r) => ({
  id: r.id,
  kind: r.kind,
  fileId: r.file_id,
  label: r.label || r.filename || '',
  name: r.filename || '',
  mime: r.mime || '',
  size: r.size || 0,
  sortOrder: r.sort_order,
});

/** 이 방의 자료 목록. 종류별로 정렬해서 준다. */
function list(roomId, kind = null) {
  const rows = db.prepare(`
    SELECT a.*, f.filename, f.mime, f.size
      FROM trpg_assets a JOIN files f ON f.id = a.file_id
     WHERE a.room_id = ? ${kind ? 'AND a.kind = ?' : ''}
     ORDER BY a.kind, COALESCE(a.sort_order, 999999), a.created_at, a.rowid`)
    .all(...(kind ? [roomId, kind] : [roomId]));
  return rows.map(view);
}

/**
 * 자료함에 있는 파일을 무대 목록에 올린다.
 * 이미 올라와 있으면 조용히 넘어간다 (같은 파일을 두 번 눌러도 중복되지 않게).
 */
function add(roomId, kind, fileId, label = null) {
  if (!KINDS.has(kind)) return null;
  const f = db.prepare('SELECT id FROM files WHERE id = ? AND room_id = ?').get(String(fileId), roomId);
  if (!f) return null;

  const already = db.prepare('SELECT id FROM trpg_assets WHERE room_id = ? AND kind = ? AND file_id = ?')
    .get(roomId, kind, f.id);
  if (already) return already.id;

  const next = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM trpg_assets WHERE room_id = ? AND kind = ?')
    .get(roomId, kind).n;
  const id = newId();
  db.prepare(`INSERT INTO trpg_assets (id, room_id, kind, file_id, label, sort_order, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, roomId, kind, f.id, label ? String(label).slice(0, 60) : null, next, Date.now());
  return id;
}

/** 목록에서만 뺀다. 파일은 자료함에 그대로 남는다. */
function remove(roomId, id) {
  return db.prepare('DELETE FROM trpg_assets WHERE id = ? AND room_id = ?').run(id, roomId).changes > 0;
}

/** 끌어서 정한 순서를 저장한다. */
function reorder(roomId, ids) {
  const stmt = db.prepare('UPDATE trpg_assets SET sort_order = ? WHERE id = ? AND room_id = ?');
  db.transaction(() => {
    (ids || []).forEach((id, i) => stmt.run(i + 1, String(id), roomId));
  })();
  return list(roomId);
}

/** 무대 목록에 올라 있는 파일인지 (파일 권한 판정에 쓴다). */
function hasFile(roomId, fileId) {
  return !!db.prepare('SELECT 1 FROM trpg_assets WHERE room_id = ? AND file_id = ?').get(roomId, fileId);
}

module.exports = { list, add, remove, reorder, hasFile, KINDS };
