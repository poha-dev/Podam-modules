'use strict';
const { db } = require('podam/db');
const { newId } = require('podam/auth');
const M = require('podam/messages');
const { norm } = require('./match');

/**
 * 「정답:답변」 표를 배역마다 두고, 제출된 정답에 짝지어진 답변을 돌려준다.
 *
 * 글은 이런 모양이다 (GM이 밖에서 만들어 붙여넣기 좋게):
 *
 *   [집사]
 *   타임루프:흥미로운 이야기입니다만, 짐작 가는 것은 없습니다.
 *   명예:"명예는 추구하는 것이 아니다." 마왕님의 명언입니다.
 *
 *   [공용]
 *   저택:낡았지만 관리는 잘 되어 있습니다.
 */

const COMMON = ['공용', '전체', 'all', 'common'];
const ASK_LIMIT = 20;          // 1분에 이만큼까지만 (장난 방지)
const asked = new Map();       // '방:사람' -> [시각, …]

const settingsRow = (roomId) =>
  db.prepare('SELECT * FROM verdict_settings WHERE room_id = ?').get(roomId);

function settings(roomId) {
  const s = settingsRow(roomId) || {};
  return {
    npcName: s.npc_name || '',
    gmFeed: s.gm_feed || 'hit',        // 'all' 전부 · 'hit' 맞혔을 때만 · 'none' 안 받기
    miss: s.miss || 'notice',
    missText: s.miss_text || '',
  };
}

function saveSettings(roomId, patch) {
  const now = settings(roomId);
  const next = {
    room_id: roomId,
    npc_name: patch.npcName !== undefined ? String(patch.npcName || '').trim().slice(0, 30) || null : (now.npcName || null),
    gm_feed: ['all', 'hit', 'none'].includes(patch.gmFeed) ? patch.gmFeed : now.gmFeed,
    miss: patch.miss === 'silent' ? 'silent' : 'notice',
    miss_text: patch.missText !== undefined ? String(patch.missText || '').trim().slice(0, 300) || null : (now.missText || null),
    updated_at: Date.now(),
  };
  db.prepare(`INSERT INTO verdict_settings (room_id, npc_name, gm_feed, miss, miss_text, updated_at)
              VALUES (@room_id, @npc_name, @gm_feed, @miss, @miss_text, @updated_at)
              ON CONFLICT(room_id) DO UPDATE SET
                npc_name=@npc_name, gm_feed=@gm_feed, miss=@miss, miss_text=@miss_text, updated_at=@updated_at`).run(next);
  return settings(roomId);
}

// ── 글 ↔ 표 ────────────────────────────────────────────────────────────────

/** 「정답:답변」 글을 줄 단위로 읽는다. [배역] 줄이 나오면 그 아래는 그 배역 몫. */
function parse(text, roleIdByName) {
  const out = [];                 // { roleId, answer, reply }
  const unknownRoles = new Set();
  let roleId = null;              // 머리말이 없으면 공용

  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;

    const head = line.match(/^\[(.+)\]$/);
    if (head) {
      const name = head[1].trim();
      if (COMMON.includes(name)) { roleId = null; continue; }
      const found = roleIdByName.get(name);
      if (found) { roleId = found; } else { roleId = null; unknownRoles.add(name); }
      continue;
    }

    const at = line.search(/[:：]/);
    if (at <= 0) continue;                       // 콜론이 없으면 줄을 건너뛴다
    const answer = line.slice(0, at).trim().slice(0, 100);
    // 답변 안의 \n 은 줄바꿈으로 바꿔준다 (한 줄로 적어도 여러 줄 답변을 만들 수 있게).
    const reply = line.slice(at + 1).trim().replace(/\\n/g, '\n').slice(0, 2000);
    if (!answer || !reply || !norm(answer)) continue;
    out.push({ roleId, answer, reply });
  }
  return { entries: out, unknownRoles: [...unknownRoles] };
}

/** 표를 다시 글로. 내보내기와 편집칸이 같은 모양을 쓴다. */
function format(roomId, roleId, { header = false } = {}) {
  const rows = db.prepare(
    `SELECT answer, reply FROM verdict_entries
      WHERE room_id = ? AND ${roleId ? 'role_id = ?' : 'role_id IS NULL'}
      ORDER BY COALESCE(sort_order, 999999), created_at, rowid`
  ).all(...(roleId ? [roomId, roleId] : [roomId]));

  const body = rows.map((r) => `${r.answer}:${r.reply.replace(/\n/g, '\\n')}`).join('\n');
  if (!header) return body;
  const name = roleId
    ? db.prepare('SELECT name FROM roles WHERE id = ?').get(roleId)?.name || '(지운 배역)'
    : '공용';
  return `[${name}]\n${body}`;
}

/** 방 전체를 하나의 글로 (내보내기). */
function exportText(roomId) {
  const roles = db.prepare('SELECT id, name FROM roles WHERE room_id = ? ORDER BY sort, created_at').all(roomId);
  const parts = [
    '# 포담 정답표',
    '# 「정답:답변」 한 줄에 하나. [배역이름] 아래는 그 배역에게만 통합니다.',
    '',
    format(roomId, null, { header: true }),
  ];
  for (const r of roles) parts.push('', format(roomId, r.id, { header: true }));
  return parts.join('\n');
}

/** 한 배역(또는 공용)의 표를 글 내용으로 통째로 바꾼다. */
function replaceRole(roomId, roleId, text) {
  const roleIdByName = new Map();      // 머리말은 무시하고 이 배역 것으로만 본다
  const { entries } = parse(text, roleIdByName);
  const now = Date.now();

  db.transaction(() => {
    db.prepare(`DELETE FROM verdict_entries WHERE room_id = ? AND ${roleId ? 'role_id = ?' : 'role_id IS NULL'}`)
      .run(...(roleId ? [roomId, roleId] : [roomId]));
    const stmt = db.prepare(`INSERT INTO verdict_entries
        (id, room_id, role_id, answer, norm, reply, sort_order, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    entries.forEach((e, i) => stmt.run(newId(), roomId, roleId, e.answer, norm(e.answer), e.reply, i, now));
  })();
  return entries.length;
}

/** 머리말이 섞인 글을 통째로 들여온다. mode: 'replace'(싹 바꾸기) | 'merge'(더하기) */
function importText(roomId, text, mode = 'replace') {
  const roles = db.prepare('SELECT id, name FROM roles WHERE room_id = ?').all(roomId);
  const byName = new Map(roles.map((r) => [r.name, r.id]));
  const { entries, unknownRoles } = parse(text, byName);
  const now = Date.now();

  db.transaction(() => {
    if (mode === 'replace') db.prepare('DELETE FROM verdict_entries WHERE room_id = ?').run(roomId);
    const stmt = db.prepare(`INSERT INTO verdict_entries
        (id, room_id, role_id, answer, norm, reply, sort_order, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    entries.forEach((e, i) => stmt.run(newId(), roomId, e.roleId, e.answer, norm(e.answer), e.reply, i, now));
  })();
  return { added: entries.length, unknownRoles };
}

// ── 판정 ───────────────────────────────────────────────────────────────────

/**
 * 이 배역이 이 말을 했을 때 나갈 답변을 찾는다.
 * 배역 몫이 먼저, 없으면 공용. 띄어쓰기·조사·대소문자는 무시한다.
 */
function lookup(roomId, roleId, text) {
  const key = norm(text);
  if (!key) return null;

  const rows = db.prepare(
    `SELECT * FROM verdict_entries WHERE room_id = ? AND (role_id IS NULL OR role_id = ?)
      ORDER BY (role_id IS NULL), COALESCE(sort_order, 999999), rowid`
  ).all(roomId, roleId || '');

  // 똑같은 말이 가장 정확하다. 없으면 적어둔 정답이 말 속에 들어 있는지 본다.
  return rows.find((r) => r.norm === key)
      || rows.find((r) => key.includes(r.norm))
      || null;
}

function tooOften(roomId, participantId) {
  const k = `${roomId}:${participantId}`;
  const now = Date.now();
  const list = (asked.get(k) || []).filter((t) => now - t < 60_000);
  list.push(now);
  asked.set(k, list);
  return list.length > ASK_LIMIT;
}

/**
 * 플레이어가 정답을 냈다. 대화에 질문과 답변을 남기고 GM에게 알린다.
 * (대화에 남기므로 즐겨찾기·기록 내보내기가 그대로 된다.)
 */
function submit({ roomId, participantId, text }) {
  const body = String(text || '').trim().slice(0, 200);
  if (!body) return { error: '무엇을 말할지 적어 주세요' };
  if (tooOften(roomId, participantId)) return { error: '조금 천천히 해주세요' };

  const p = db.prepare('SELECT * FROM participants WHERE id = ? AND room_id = ? AND kicked_at IS NULL')
    .get(participantId, roomId);
  if (!p) return { error: '참가자를 찾을 수 없습니다' };

  const cfg = settings(roomId);
  const entry = lookup(roomId, p.role_id, body);

  // GM 화면을 울릴지는 설정을 따른다. 기록에는 언제나 남는다.
  //   all  — 물은 것도 답도 모두 GM에게
  //   hit  — 맞혔을 때만 (기본). 헛짚은 것까지 알림이 오면 진짜 질문을 놓친다
  //   none — 아무것도 알리지 않음
  const quiet = cfg.gmFeed === 'none' || (cfg.gmFeed === 'hit' && !entry);

  M.deliver({ roomId, participantId, sender: 'player', kind: 'vask', body, quietToGm: quiet });

  let reply = null;
  if (entry) {
    reply = M.deliver({
      roomId, participantId, sender: 'gm', kind: 'vans',
      body: entry.reply, npcName: cfg.npcName || null,
      quietToGm: cfg.gmFeed === 'none',
    });
  } else if (cfg.miss !== 'silent' && cfg.missText) {
    // 문구를 비워두면 아무 말도 하지 않는다 (빈 말풍선으로 자리를 차지하지 않게).
    M.deliver({
      roomId, participantId, sender: 'system', kind: 'text',
      body: cfg.missText, quietToGm: quiet,
    });
  }

  db.prepare(`INSERT INTO verdict_log (id, room_id, participant_id, asked, entry_id, created_at)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(newId(), roomId, participantId, body, entry ? entry.id : null, Date.now());

  if (cfg.gmFeed === 'all' || (cfg.gmFeed === 'hit' && entry)) {
    M.notifyGm(roomId, 'verdict:event', {
      type: entry ? 'hit' : 'miss',
      participantId, nickname: p.nickname, asked: body,
      answer: entry ? entry.answer : null, at: Date.now(),
    });
  } else {
    // 알림은 안 보내도 GM 화면의 기록은 조용히 갱신해 준다.
    M.notifyGm(roomId, 'verdict:quiet', { at: Date.now() });
  }

  return { ok: true, matched: !!entry, reply: reply ? reply.body : null };
}

/** 발송 없이 어떤 답이 나갈지만 본다 (GM 시험용). */
function dryRun(roomId, roleId, text) {
  const entry = lookup(roomId, roleId || null, text);
  return entry ? { matched: true, answer: entry.answer, reply: entry.reply } : { matched: false };
}

/** GM 화면에 뿌릴 한 벌. */
function snapshot(roomId) {
  const roles = db.prepare('SELECT id, name FROM roles WHERE room_id = ? ORDER BY sort, created_at').all(roomId);
  const countOf = (roleId) => db.prepare(
    `SELECT COUNT(*) n FROM verdict_entries WHERE room_id = ? AND ${roleId ? 'role_id = ?' : 'role_id IS NULL'}`
  ).get(...(roleId ? [roomId, roleId] : [roomId])).n;

  const log = db.prepare(
    `SELECT l.*, e.answer FROM verdict_log l LEFT JOIN verdict_entries e ON e.id = l.entry_id
      WHERE l.room_id = ? ORDER BY l.created_at DESC LIMIT 40`
  ).all(roomId).map((r) => ({
    id: r.id, participantId: r.participant_id, asked: r.asked,
    matched: !!r.entry_id, answer: r.answer || null, createdAt: r.created_at,
  }));

  return {
    settings: settings(roomId),
    tables: [{ roleId: null, name: '공용', count: countOf(null), text: format(roomId, null) }]
      .concat(roles.map((r) => ({ roleId: r.id, name: r.name, count: countOf(r.id), text: format(roomId, r.id) }))),
    log,
  };
}

module.exports = {
  settings, saveSettings, parse, format, exportText, replaceRole, importText,
  lookup, submit, dryRun, snapshot,
};
