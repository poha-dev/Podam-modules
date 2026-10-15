'use strict';
const express = require('express');
const { identify } = require('podam/auth');
const { requireGm } = require('podam/guards');
const STATE = require('podam/modules/state');
const UP = require('podam/upload');
const ASSETS = require('./assets');
const BOARD = require('./board');
const CHAT = require('./chat');
const ROLLS = require('./rolls');

const router = express.Router();

/** 이 방에서 모듈이 꺼져 있으면 아예 없는 기능처럼 답한다. */
function onlyWhenOn(req, res, next) {
  if (!STATE.isEnabled(req.room, 'trpg')) {
    return res.status(404).json({ error: '사용하지 않는 기능입니다' });
  }
  next();
}

/**
 * 공용 무대는 GM도 플레이어도 함께 쓴다.
 * guards.js 는 둘을 갈라 놓았으므로 여기서만 합쳐 쓴다.
 */
function requireMember(req, res, next) {
  const who = identify(req);
  if (!who) return res.status(403).json({ error: '권한이 없습니다' });
  req.room = who.room;
  req.who = who;
  next();
}

const gmOnly = [requireGm, onlyWhenOn];
const member = [requireMember, onlyWhenOn];

// ── 공용 대화에 파일 올리기 (GM·플레이어 모두) ──────────────────────────────
router.post('/trpg/upload', requireMember, onlyWhenOn, UP.upload.array('files', 5), (req, res) => {
  // 방이 닫혀 있으면 플레이어는 올릴 수 없다 (1:1 대화와 같은 규칙).
  if (req.who.role === 'player' && req.room.closed) {
    return res.status(410).json({ error: '종료된 방입니다' });
  }
  const data = req.who.role === 'gm'
    ? { role: 'gm', gmId: req.who.gm.id }
    : { role: 'player', participantId: req.who.participant.id };
  const actor = CHAT.actorOf(req.room.id, data);
  if (!actor) return res.status(403).json({ error: '권한이 없습니다' });

  const body = String(req.body?.body || '').trim().slice(0, 500) || null;
  const sent = (req.files || []).map((f, i) => {
    const row = UP.insertFile({
      roomId: req.room.id,
      uploader: req.who.role,
      participantId: req.who.role === 'player' ? req.who.participant.id : null,
      file: f,
      isPreset: false,
    });
    // 설명은 첫 파일에만 붙인다 (같은 말이 여러 번 나오지 않게).
    return CHAT.add(req.room.id, actor, { kind: 'file', body: i === 0 ? body : null, fileId: row.id });
  });
  if (sent.length === 0) return res.status(400).json({ error: '보낼 파일이 없습니다' });
  res.json({ sent: sent.length });
});

// ── GM 조작판이 한 벌로 받아 가는 것 ────────────────────────────────────────
router.get('/gm/trpg', gmOnly, (req, res) => {
  res.json({
    board: BOARD.get(req.room.id),
    assets: ASSETS.list(req.room.id),
    messages: CHAT.history(req.room.id),
  });
});

/** 자료함에 이미 있는 파일을 무대 목록에 올린다. */
router.post('/gm/trpg/assets', gmOnly, (req, res) => {
  const kind = String(req.body?.kind || '');
  if (!ASSETS.KINDS.has(kind)) return res.status(400).json({ error: '알 수 없는 종류입니다' });
  const ids = Array.isArray(req.body?.fileIds) ? req.body.fileIds : [req.body?.fileId];
  let added = 0;
  for (const fid of ids) if (ASSETS.add(req.room.id, kind, fid, req.body?.label)) added++;
  if (added === 0) return res.status(404).json({ error: '이 방의 파일이 아닙니다' });
  res.json({ added, assets: ASSETS.list(req.room.id) });
});

/** 새 파일을 올리면서 바로 무대 목록에 넣는다 (자료함에도 남는다). */
router.post('/gm/trpg/assets/upload', requireGm, onlyWhenOn, UP.upload.array('files', 10), (req, res) => {
  const kind = String(req.body?.kind || '');
  if (!ASSETS.KINDS.has(kind)) return res.status(400).json({ error: '알 수 없는 종류입니다' });
  let added = 0;
  for (const f of req.files || []) {
    // is_preset=1 로 넣는다 — 룸 셋팅(zip)이 자료함 파일만 싣기 때문이다.
    const row = UP.insertFile({
      roomId: req.room.id, uploader: 'gm', file: f, isPreset: true,
      label: kind === 'bgm' ? '무대 음악' : '무대 그림',
    });
    if (ASSETS.add(req.room.id, kind, row.id)) added++;
  }
  if (added === 0) return res.status(400).json({ error: '올릴 파일이 없습니다' });
  res.json({ added, assets: ASSETS.list(req.room.id) });
});

router.put('/gm/trpg/assets/order', gmOnly, (req, res) => {
  res.json({ assets: ASSETS.reorder(req.room.id, req.body?.ids) });
});

router.delete('/gm/trpg/assets/:id', gmOnly, (req, res) => {
  if (!ASSETS.remove(req.room.id, req.params.id)) {
    return res.status(404).json({ error: '없는 자료입니다' });
  }
  res.json({ assets: ASSETS.list(req.room.id) });
});

/** 굴린 기록 (비밀 굴림 포함 — GM만). */
router.get('/gm/trpg/rolls', gmOnly, (req, res) => {
  res.json({ rolls: ROLLS.recent(req.room.id, true, 100) });
});

/** 공용 대화 비우기. */
router.post('/gm/trpg/clear', gmOnly, (req, res) => {
  res.json({ cleared: CHAT.clear(req.room.id) });
});

module.exports = { router, member, gmOnly };
