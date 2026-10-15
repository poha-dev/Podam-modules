'use strict';
const { db } = require('podam/db');
const { newId } = require('podam/auth');
const M = require('podam/messages');

/**
 * 공용 대화 — 방에 있는 모두가 같은 줄을 본다.
 *
 * 퍼뜨리는 길은 `M.notifyEveryone` 하나뿐이다. 이 함수는 GM 방과 **쫓겨나지 않은**
 * 플레이어들의 스레드 방에 하나씩 보내 준다. 방 전체를 가리키는 소켓 방(`r:<방id>`)은
 * 여전히 만들지 않는다 — 그런 방이 하나라도 생기면, 나중에 누군가 그 이름을 복사해
 * 1:1 대화를 거기에 보내는 사고가 날 수 있기 때문이다.
 */

const LIMIT = 200;                    // 화면에 한 번에 뿌리는 줄 수

const fileOf = (id) => (id
  ? db.prepare('SELECT id, filename, mime, size FROM files WHERE id = ?').get(id)
  : null);

/** 말한 사람의 지금 이름 색. 색을 바꾸면 지난 줄도 함께 다시 칠해진다. */
function colorOf(r) {
  if (r.sender === 'gm' && r.gm_id) {
    return db.prepare('SELECT color FROM gms WHERE id = ?').get(r.gm_id)?.color || null;
  }
  if (r.sender === 'player' && r.participant_id) {
    return db.prepare('SELECT color FROM participants WHERE id = ?').get(r.participant_id)?.color || null;
  }
  return null;
}

function view(r) {
  const f = fileOf(r.file_id);
  return {
    id: r.id,
    sender: r.sender,                 // 'gm' | 'player' | 'system'
    gmId: r.gm_id || null,
    participantId: r.participant_id || null,
    nickname: r.nickname || '',
    color: colorOf(r),
    kind: r.kind,
    body: r.body || null,
    meta: r.meta ? JSON.parse(r.meta) : null,
    file: f ? { id: f.id, name: f.filename, mime: f.mime, size: f.size } : null,
    createdAt: r.created_at,
  };
}

/** 최근 줄. 오래된 것부터 (화면이 그대로 이어 붙일 수 있게). */
function history(roomId, limit = LIMIT) {
  const rows = db.prepare(`SELECT * FROM trpg_messages
                           WHERE room_id = ? AND deleted_at IS NULL
                           ORDER BY created_at DESC, rowid DESC LIMIT ?`).all(roomId, limit);
  return rows.reverse().map(view);
}

/** 누가 말했는지. 소켓의 신원만 믿는다 (클라이언트가 보낸 이름은 쓰지 않는다). */
function actorOf(roomId, data) {
  if (data.role === 'gm') {
    const gm = db.prepare('SELECT id, nickname FROM gms WHERE id = ? AND room_id = ?')
      .get(data.gmId, roomId);
    return gm && { sender: 'gm', gmId: gm.id, participantId: null, nickname: gm.nickname || 'GM' };
  }
  const p = db.prepare(`SELECT id, nickname FROM participants
                        WHERE id = ? AND room_id = ? AND kicked_at IS NULL`)
    .get(data.participantId, roomId);
  return p && { sender: 'player', gmId: null, participantId: p.id, nickname: p.nickname || '' };
}

/**
 * 한 줄 남기기만 하고 **보내지는 않는다.**
 * 주사위는 굴러가는 것을 다 본 뒤에 결과 말풍선이 떠야 해서, 화면이 직접 띄운다.
 */
function record(roomId, actor, { kind = 'text', body = null, fileId = null, meta = null }) {
  const r = {
    id: newId(),
    room_id: roomId,
    sender: actor.sender,
    gm_id: actor.gmId,
    participant_id: actor.participantId,
    nickname: actor.nickname,
    kind,
    body,
    file_id: fileId,
    meta: meta ? JSON.stringify(meta) : null,
    created_at: Date.now(),
  };
  db.prepare(`INSERT INTO trpg_messages
      (id, room_id, sender, gm_id, participant_id, nickname, kind, body, file_id, meta, created_at)
    VALUES (@id, @room_id, @sender, @gm_id, @participant_id, @nickname, @kind, @body, @file_id, @meta, @created_at)`)
    .run(r);

  return view(r);
}

/** 한 줄 남기고 모두에게 보낸다. */
function add(roomId, actor, fields) {
  const msg = record(roomId, actor, fields);
  M.notifyEveryone(roomId, 'trpg:msg', msg);
  return msg;
}

/**
 * 자기가 쓴 줄만 지운다. GM은 아무 줄이나 지울 수 있다
 * (1:1 대화의 삭제 규칙과 같다 — 무대는 GM의 판이므로).
 */
function remove(roomId, id, data) {
  const r = db.prepare('SELECT * FROM trpg_messages WHERE id = ? AND room_id = ?').get(id, roomId);
  if (!r || r.deleted_at) return '없는 줄입니다';
  const mine = data.role === 'gm' ? true : r.participant_id === data.participantId;
  if (!mine) return '내가 쓴 것만 지울 수 있습니다';

  db.prepare('UPDATE trpg_messages SET deleted_at = ?, deleted_by = ? WHERE id = ?')
    .run(Date.now(), data.role === 'gm' ? data.gmId : data.participantId, id);
  M.notifyEveryone(roomId, 'trpg:msg:del', { id });
  return null;
}

/** 공용 대화를 통째로 비운다 (GM). 파일 자체는 자료함에 남는다. */
function clear(roomId) {
  const n = db.prepare('UPDATE trpg_messages SET deleted_at = ? WHERE room_id = ? AND deleted_at IS NULL')
    .run(Date.now(), roomId).changes;
  M.notifyEveryone(roomId, 'trpg:cleared', { at: Date.now() });
  return n;
}

/** 공용 대화가 지금도 가리키고 있는 파일인지 (파일 권한 판정에 쓴다). */
function hasFile(roomId, fileId) {
  return !!db.prepare(`SELECT 1 FROM trpg_messages
                       WHERE room_id = ? AND file_id = ? AND deleted_at IS NULL`).get(roomId, fileId);
}

module.exports = { history, actorOf, add, record, remove, clear, hasFile, view, LIMIT };
