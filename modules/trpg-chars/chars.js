'use strict';
const { db } = require('podam/db');
const { newId } = require('podam/auth');
const M = require('podam/messages');

/**
 * 캐릭터 카드 — 그림 + 수치(HP·MP 같은 것) + 상태이상.
 *
 * 룰마다 쓰는 항목이 달라서 칸을 미리 정해 두지 않는다. 방마다 **기본 틀**을 두고,
 * 카드마다 항목을 더하거나 뺄 수 있게 한다.
 *
 * 누가 무엇을 고칠 수 있는지는 **여기서만** 판단한다. 화면은 보여 주기만 한다.
 *   - GM: 전부
 *   - 플레이어: 자기 카드만. 숨김(hidden)은 건드릴 수 없다.
 */

const MAX_PER_ROOM = 24;      // 방 전체 카드 수
const MAX_PER_PLAYER = 3;     // 한 사람이 가질 수 있는 카드 수
const MAX_STATS = 12;
const MAX_STATUS = 12;

const DEFAULT_TEMPLATE = [
  { label: 'HP', cur: 10, max: 10 },
  { label: 'MP', cur: 5, max: 5 },
];

// ── 다듬기 ────────────────────────────────────────────────────────────────
const text = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const int = (v, dflt = 0) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(9999, Math.max(-9999, n)) : dflt;
};

function cleanStats(rows) {
  return (Array.isArray(rows) ? rows : []).slice(0, MAX_STATS)
    .map((r) => ({ label: text(r?.label, 12), cur: int(r?.cur), max: int(r?.max) }))
    .filter((r) => r.label);
}

function cleanStatus(rows) {
  return [...new Set((Array.isArray(rows) ? rows : [])
    .map((s) => text(s, 12))
    .filter(Boolean))].slice(0, MAX_STATUS);
}

// ── 방 기본 틀 ────────────────────────────────────────────────────────────
function template(roomId) {
  const r = db.prepare('SELECT stat_template FROM trpg_char_setup WHERE room_id = ?').get(roomId);
  if (!r?.stat_template) return DEFAULT_TEMPLATE.map((x) => ({ ...x }));
  try {
    const rows = cleanStats(JSON.parse(r.stat_template));
    return rows.length ? rows : DEFAULT_TEMPLATE.map((x) => ({ ...x }));
  } catch { return DEFAULT_TEMPLATE.map((x) => ({ ...x })); }
}

function setTemplate(roomId, rows) {
  const clean = cleanStats(rows);
  db.prepare(`INSERT INTO trpg_char_setup (room_id, stat_template, updated_at)
              VALUES (?, ?, ?)
              ON CONFLICT(room_id) DO UPDATE SET stat_template = excluded.stat_template,
                                                 updated_at = excluded.updated_at`)
    .run(roomId, JSON.stringify(clean), Date.now());
  return clean;
}

// ── 목록 ──────────────────────────────────────────────────────────────────
const view = (r) => ({
  id: r.id,
  ownerId: r.owner_id || null,
  name: r.name,
  imageFileId: r.image_file_id || null,
  stats: JSON.parse(r.stats),
  status: JSON.parse(r.status),
  note: r.note || '',
  hidden: !!r.hidden,
  onStage: !!r.on_stage,
  x: r.pos_x,
  y: r.pos_y,
  sortOrder: r.sort_order,
  updatedAt: r.updated_at,
});

/** 숨긴 카드는 GM에게만 보인다. 플레이어 목록에는 아예 담지 않는다. */
function list(roomId, isGm) {
  const rows = db.prepare(`SELECT * FROM trpg_chars
                           WHERE room_id = ? ${isGm ? '' : 'AND hidden = 0'}
                           ORDER BY COALESCE(sort_order, 999999), created_at, rowid`).all(roomId);
  return rows.map(view);
}

const get = (roomId, id) =>
  db.prepare('SELECT * FROM trpg_chars WHERE id = ? AND room_id = ?').get(String(id || ''), roomId);

/** 바뀐 목록을 각자에게 맞게 보낸다 (숨긴 카드가 섞이지 않게 둘로 나눠 보낸다). */
function broadcast(roomId) {
  M.notifyGm(roomId, 'chars:list', { chars: list(roomId, true) });
  M.notifyPlayers(roomId, 'chars:list', { chars: list(roomId, false) });
}

// ── 만들기·고치기 ─────────────────────────────────────────────────────────
/**
 * @param who  { role:'gm'|'player', gmId?, participantId? } — 소켓이 들고 있는 신원
 * @param p    { id?, name, stats, status, note, imageFileId, hidden, ownerId }
 * @returns    { char } | { error }
 */
function save(roomId, who, p = {}) {
  const isGm = who.role === 'gm';
  const now = Date.now();
  const cur = p.id ? get(roomId, p.id) : null;

  if (p.id && !cur) return { error: '없는 카드입니다' };
  if (cur && !isGm && cur.owner_id !== who.participantId) {
    return { error: '내 카드만 고칠 수 있습니다' };
  }

  if (!cur) {
    const total = db.prepare('SELECT COUNT(*) n FROM trpg_chars WHERE room_id = ?').get(roomId).n;
    if (total >= MAX_PER_ROOM) return { error: `카드는 ${MAX_PER_ROOM}장까지 만들 수 있습니다` };
    if (!isGm) {
      const mine = db.prepare('SELECT COUNT(*) n FROM trpg_chars WHERE room_id = ? AND owner_id = ?')
        .get(roomId, who.participantId).n;
      if (mine >= MAX_PER_PLAYER) return { error: `한 사람이 ${MAX_PER_PLAYER}장까지 가질 수 있습니다` };
    }
  }

  // 새 카드는 기댈 예전 값이 없다 — 안 보낸 칸은 빈 값으로 두고, 항목은 아래에서 기본 틀로 채운다.
  const name = text(p.name, 20) || (cur ? cur.name : '이름 없음');
  const stats = p.stats !== undefined ? cleanStats(p.stats) : (cur ? JSON.parse(cur.stats) : []);
  const status = p.status !== undefined ? cleanStatus(p.status) : (cur ? JSON.parse(cur.status) : []);
  const note = p.note !== undefined ? text(p.note, 200) : (cur?.note || '');

  // 주인과 숨김은 GM만 정한다. 플레이어가 보내면 조용히 무시한다.
  let ownerId = cur ? cur.owner_id : (isGm ? null : who.participantId);
  if (isGm && p.ownerId !== undefined) {
    const found = p.ownerId
      ? db.prepare('SELECT id FROM participants WHERE id = ? AND room_id = ?').get(String(p.ownerId), roomId)
      : null;
    ownerId = found ? found.id : null;
  }
  const hidden = isGm ? (p.hidden !== undefined ? (p.hidden ? 1 : 0) : (cur?.hidden || 0)) : (cur?.hidden || 0);

  if (cur) {
    db.prepare(`UPDATE trpg_chars SET name=?, stats=?, status=?, note=?, owner_id=?, hidden=?, updated_at=?
                WHERE id = ? AND room_id = ?`)
      .run(name, JSON.stringify(stats), JSON.stringify(status), note, ownerId, hidden, now, cur.id, roomId);
    broadcast(roomId);
    return { char: view(get(roomId, cur.id)) };
  }

  const next = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM trpg_chars WHERE room_id = ?')
    .get(roomId).n;
  const id = newId();
  db.prepare(`INSERT INTO trpg_chars
      (id, room_id, owner_id, name, image_file_id, stats, status, note, hidden, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, roomId, ownerId, name,
      JSON.stringify(stats.length ? stats : template(roomId)),
      JSON.stringify(status), note, hidden, next, now, now);
  broadcast(roomId);
  return { char: view(get(roomId, id)) };
}

function remove(roomId, who, id) {
  const cur = get(roomId, id);
  if (!cur) return { error: '없는 카드입니다' };
  if (who.role !== 'gm' && cur.owner_id !== who.participantId) {
    return { error: '내 카드만 지울 수 있습니다' };
  }
  db.prepare('DELETE FROM trpg_chars WHERE id = ? AND room_id = ?').run(cur.id, roomId);
  broadcast(roomId);
  return { ok: true };
}

/** 그림을 바꾼다 (파일은 이미 올라와 있다). */
function setImage(roomId, who, id, fileId) {
  const cur = get(roomId, id);
  if (!cur) return { error: '없는 카드입니다' };
  if (who.role !== 'gm' && cur.owner_id !== who.participantId) {
    return { error: '내 카드만 고칠 수 있습니다' };
  }
  db.prepare('UPDATE trpg_chars SET image_file_id = ?, updated_at = ? WHERE id = ? AND room_id = ?')
    .run(fileId || null, Date.now(), cur.id, roomId);
  broadcast(roomId);
  return { char: view(get(roomId, cur.id)) };
}

/**
 * 무대 위 토큰 자리.
 *
 * **누구나 옮길 수 있다** — 탁자 위의 말을 아무나 밀 수 있는 것과 같다.
 * 다만 숨긴 카드는 GM만 다룬다 (플레이어에게는 있다는 사실도 알리지 않는다).
 */
function place(roomId, who, { id, x, y, on }) {
  const cur = get(roomId, id);
  if (!cur) return { error: '없는 카드입니다' };
  if (cur.hidden && who.role !== 'gm') return { error: '권한이 없습니다' };

  const clamp = (v, dflt) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : dflt;
  };
  const next = {
    x: x === undefined ? cur.pos_x : clamp(x, cur.pos_x),
    y: y === undefined ? cur.pos_y : clamp(y, cur.pos_y),
    on: on === undefined ? cur.on_stage : (on ? 1 : 0),
  };
  db.prepare('UPDATE trpg_chars SET pos_x = ?, pos_y = ?, on_stage = ?, updated_at = ? WHERE id = ? AND room_id = ?')
    .run(next.x, next.y, next.on, Date.now(), cur.id, roomId);

  // 자리만 바뀌었으므로 목록을 통째로 보내지 않는다 (끄는 동안 자주 온다).
  const payload = { id: cur.id, x: next.x, y: next.y, onStage: !!next.on };
  if (cur.hidden) M.notifyGm(roomId, 'chars:move', payload);
  else M.notifyEveryone(roomId, 'chars:move', payload);
  return { ok: true, ...payload };
}

/** 끌어서 정한 순서 (GM만). */
function reorder(roomId, ids) {
  const stmt = db.prepare('UPDATE trpg_chars SET sort_order = ? WHERE id = ? AND room_id = ?');
  db.transaction(() => {
    (Array.isArray(ids) ? ids : []).forEach((id, i) => stmt.run(i + 1, String(id), roomId));
  })();
  broadcast(roomId);
  return list(roomId, true);
}

/**
 * 파일 권한 판정용 — 이 방의 카드 그림인가.
 * 숨긴 카드의 그림은 플레이어에게 열어 주지 않는다 (카드의 존재 자체가 새면 안 된다).
 */
function hasFile(roomId, fileId) {
  return !!db.prepare(`SELECT 1 FROM trpg_chars
                       WHERE room_id = ? AND image_file_id = ? AND hidden = 0`).get(roomId, fileId);
}

/** 숨김 여부와 상관없이 이 파일을 쓰고 있는지 (자료함에서 지울 때 물어본다). */
function usesFile(roomId, fileId) {
  return !!db.prepare('SELECT 1 FROM trpg_chars WHERE room_id = ? AND image_file_id = ?')
    .get(roomId, fileId);
}

module.exports = {
  list, get, save, remove, setImage, place, reorder, broadcast, usesFile,
  template, setTemplate, hasFile, view,
  MAX_PER_ROOM, MAX_PER_PLAYER, MAX_STATS, MAX_STATUS, DEFAULT_TEMPLATE,
};
