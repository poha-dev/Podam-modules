'use strict';
const { db } = require('podam/db');
const { newId } = require('podam/auth');
const M = require('podam/messages');
const DICE = require('./dice');
const CHAT = require('./chat');

/**
 * 굴린 것을 남기고 퍼뜨린다.
 *
 * 순서가 중요하다 — **결과 말풍선은 주사위가 다 구른 뒤에** 떠야 한다.
 * 그래서 서버는 대화 줄을 DB에 남기기만 하고(`CHAT.record`), 퍼뜨리는 것은
 * 굴림 알림(`trpg:roll`) 하나뿐이다. 말풍선은 각 화면이 굴림이 끝난 뒤에 직접 띄운다.
 */

const view = (r) => ({
  id: r.id,
  sender: r.sender,
  actorId: r.actor_id,
  nickname: r.nickname,
  color: colorOf(r),
  notation: r.notation,
  detail: r.detail,
  total: r.total,
  dice: JSON.parse(r.dice),
  strength: r.strength,
  secret: !!r.secret,
  createdAt: r.created_at,
});

/** 굴린 사람의 지금 이름 색 (말풍선 이름에 입힌다). */
function colorOf(r) {
  const table = r.sender === 'gm' ? 'gms' : 'participants';
  return (r.actor_id
    ? db.prepare(`SELECT color FROM ${table} WHERE id = ?`).get(r.actor_id)?.color
    : null) || null;
}

/** 최근 굴림. 플레이어에게는 비밀 굴림을 주지 않는다. */
function recent(roomId, isGm, limit = 30) {
  const rows = db.prepare(`SELECT * FROM trpg_rolls
                           WHERE room_id = ? ${isGm ? '' : 'AND secret = 0'}
                           ORDER BY created_at DESC, rowid DESC LIMIT ?`).all(roomId, limit);
  return rows.reverse().map(view);
}

/**
 * 굴린다.
 * @param actor CHAT.actorOf 가 돌려준 것
 * @param text  '1d20+3' 같은 식 (화면에서 '/' 와 roll 은 떼어 보낸다) (없으면 단추로 담은 stage 를 식으로 바꾼다)
 */
function make(roomId, actor, { text, stage, strength, secret }) {
  const src = String(text || '').trim() || DICE.fromStage(stage);

  let out;
  try {
    out = DICE.roll(src);
  } catch (e) {
    return { error: e.message };
  }

  const power = Number(strength);
  const row = {
    id: newId(),
    room_id: roomId,
    sender: actor.sender,
    actor_id: actor.gmId || actor.participantId,
    nickname: actor.nickname,
    notation: out.notation,
    detail: out.detail,
    total: out.total,
    dice: JSON.stringify(out.dice),
    strength: Number.isFinite(power) ? Math.min(1, Math.max(0, power)) : null,
    secret: secret ? 1 : 0,
    created_at: Date.now(),
  };
  db.prepare(`INSERT INTO trpg_rolls
      (id, room_id, sender, actor_id, nickname, notation, detail, total, dice, strength, secret, created_at)
    VALUES (@id, @room_id, @sender, @actor_id, @nickname, @notation, @detail, @total, @dice, @strength, @secret, @created_at)`)
    .run(row);

  const roll = view(row);

  if (secret) {
    // 비밀 굴림은 공용 대화에 줄을 남기지 않는다.
    // 남기면 「GM이 뭔가 굴렸다」는 사실 자체가 새어 나간다.
    M.notifyGm(roomId, 'trpg:roll', roll);
    return { roll };
  }

  // 말풍선은 굴림이 끝난 뒤 화면이 띄운다. 여기서는 기록만 남긴다.
  const msg = CHAT.record(roomId, actor, {
    kind: 'dice',
    body: DICE.line(out),
    meta: { rollId: roll.id, total: roll.total, notation: roll.notation, detail: roll.detail },
  });
  roll.message = msg;
  M.notifyEveryone(roomId, 'trpg:roll', roll);
  return { roll };
}

module.exports = { make, recent, view };
