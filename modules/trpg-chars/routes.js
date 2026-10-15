'use strict';
const express = require('express');
const { identify } = require('podam/auth');
const UP = require('podam/upload');
const CHARS = require('./chars');

const router = express.Router();

/** 이 모듈과 주인 모듈(무대)이 둘 다 켜져 있어야 한다. */
function ready(req, res, next) {
  if (!require('./index').ready(req.room.id)) {
    return res.status(404).json({ error: '사용하지 않는 기능입니다' });
  }
  next();
}

/** GM도 플레이어도 함께 쓴다. */
function requireMember(req, res, next) {
  const who = identify(req);
  if (!who) return res.status(403).json({ error: '권한이 없습니다' });
  req.room = who.room;
  req.who = who;
  next();
}

/** 카드 그림. 카드를 고칠 수 있는 사람만 바꿀 수 있다. */
router.post('/trpg-chars/:id/image', requireMember, ready, UP.upload.array('files', 1), (req, res) => {
  const who = req.who.role === 'gm'
    ? { role: 'gm', gmId: req.who.gm.id }
    : { role: 'player', participantId: req.who.participant.id };

  const file = (req.files || [])[0];
  if (!file) return res.status(400).json({ error: '그림이 없습니다' });
  if (!/^image\//.test(file.mimetype)) return res.status(415).json({ error: '그림 파일만 됩니다' });

  const row = UP.insertFile({
    roomId: req.room.id,
    uploader: req.who.role,
    participantId: req.who.role === 'player' ? req.who.participant.id : null,
    file,
    // GM이 올린 그림만 룸 셋팅(zip)에 실린다. 플레이어 얼굴이 남의 방으로 따라가지 않게.
    isPreset: req.who.role === 'gm',
    label: '캐릭터 그림',
  });
  const out = CHARS.setImage(req.room.id, who, req.params.id, row.id);
  if (out.error) return res.status(403).json(out);
  res.json(out);
});

module.exports = { router };
