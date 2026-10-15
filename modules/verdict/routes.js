'use strict';
const express = require('express');
const { requireGm } = require('podam/guards');
const STATE = require('podam/modules/state');
const E = require('./engine');

const router = express.Router();

/** 이 방에서 모듈이 꺼져 있으면 아예 없는 기능처럼 답한다. */
function onlyWhenOn(req, res, next) {
  if (!STATE.isEnabled(req.room, 'verdict')) {
    return res.status(404).json({ error: '사용하지 않는 기능입니다' });
  }
  next();
}
const guard = [requireGm, onlyWhenOn];

router.get('/gm/verdict', guard, (req, res) => res.json(E.snapshot(req.room.id)));

router.put('/gm/verdict/settings', guard, (req, res) => {
  E.saveSettings(req.room.id, {
    npcName: req.body?.npcName,
    gmFeed: req.body?.gmFeed,
    miss: req.body?.miss,
    missText: req.body?.missText,
  });
  res.json(E.snapshot(req.room.id));        // 화면이 한 벌을 통째로 다시 그린다
});

/** 한 배역(또는 공용)의 정답표를 글 내용으로 바꾼다. */
router.put('/gm/verdict/table', guard, (req, res) => {
  const roleId = req.body?.roleId || null;
  if (roleId) {
    const role = require('podam/db').db
      .prepare('SELECT id FROM roles WHERE id = ? AND room_id = ?').get(roleId, req.room.id);
    if (!role) return res.status(404).json({ error: '없는 배역입니다' });
  }
  const count = E.replaceRole(req.room.id, roleId, String(req.body?.text || ''));
  res.json({ count, ...E.snapshot(req.room.id) });
});

/** 밖에서 만든 정답표를 통째로 들여온다. */
router.post('/gm/verdict/import', guard, (req, res) => {
  const mode = req.body?.mode === 'merge' ? 'merge' : 'replace';
  const out = E.importText(req.room.id, String(req.body?.text || ''), mode);
  res.json({ ...out, ...E.snapshot(req.room.id) });
});

/** 지금 정답표를 글 파일로 내려받는다 (그대로 다시 들여올 수 있다). */
router.get('/gm/verdict/export', (req, res) => {
  const who = require('podam/auth').identify(req);   // window.open 으로 열 수 있게 ?gm= 허용
  if (!who || who.role !== 'gm') return res.status(403).send('권한이 없습니다');
  if (!STATE.isEnabled(who.room, 'verdict')) return res.status(404).send('사용하지 않는 기능입니다');

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition',
    `attachment; filename*=UTF-8''${encodeURIComponent(`${who.room.name}_정답표_${stamp}.txt`)}`);
  res.send(E.exportText(who.room.id));
});

/** 보내지 않고 어떤 답이 나갈지만 본다. */
router.post('/gm/verdict/test', guard, (req, res) => {
  res.json(E.dryRun(req.room.id, req.body?.roleId || null, String(req.body?.text || '')));
});

module.exports = { router };
