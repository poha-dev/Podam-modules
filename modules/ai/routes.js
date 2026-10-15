'use strict';
const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const multer = require('multer');
const { identify, newId } = require('podam/auth');
const { requireGm } = require('podam/guards');
const { UPLOAD_DIR } = require('podam/db');
const STATE = require('podam/modules/state');
const UP = require('podam/upload');
const W = require('./works');
const P = require('./portable');

const router = express.Router();

/** 이 방에서 모듈이 꺼져 있으면 아예 없는 기능처럼 답한다. */
function onlyWhenOn(req, res, next) {
  if (!STATE.isEnabled(req.room, 'ai')) {
    return res.status(404).json({ error: '사용하지 않는 기능입니다' });
  }
  next();
}
const guard = [requireGm, onlyWhenOn];

/**
 * 자료 올리기 — 끌어다 놓은 폴더의 파일들이 열 개씩 나뉘어 들어온다.
 *
 * `paths` 는 파일과 같은 순서의 폴더 안 경로다 (화면에 어디서 온 파일인지 보여주려고).
 * 올린 파일은 **자료함에 뜨지 않는다**(`isPreset:false`) — 시나리오 원본이
 * GM 자료함에 섞이면 실수로 플레이어에게 보내게 된다.
 */
router.post('/gm/ai/work/:id/upload', guard, UP.upload.array('files', 10), (req, res) => {
  const work = W.get(req.room.id, req.params.id);
  if (!work) return res.status(404).json({ error: '없는 작품입니다' });

  let paths = [];
  try { paths = JSON.parse(req.body?.paths || '[]'); } catch { paths = []; }

  const out = [];
  (req.files || []).forEach((file, i) => {
    const row = UP.insertFile({
      roomId: req.room.id,
      uploader: 'gm',
      file,
      isPreset: false,                        // 자료함에는 두지 않는다
      label: 'AI 자료',
    });
    const made = W.addDoc(req.room.id, work.id, {
      fileId: row.id,
      name: row.filename,
      path: Array.isArray(paths) ? paths[i] : '',
      mime: row.mime,
      bytes: row.size,
    });
    if (made.doc) out.push(made.doc);
  });

  if (!out.length) return res.status(400).json({ error: '넣은 자료가 없습니다' });
  res.json({ docs: out });
});

/** 분석 결과 내보내기. window.open 으로 열 수 있게 ?gm= 도 받는다. */
router.get('/gm/ai/work/:id/export', (req, res) => {
  const who = identify(req);
  if (!who || who.role !== 'gm') return res.status(403).send('권한이 없습니다');
  if (!STATE.isEnabled(who.room, 'ai')) return res.status(404).send('사용하지 않는 기능입니다');

  const data = P.collectWork(who.room.id, req.params.id);
  if (!data) return res.status(404).send('없는 작품입니다');

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition',
    `attachment; filename*=UTF-8''${encodeURIComponent(`${data.work.name}.mmai.json`)}`);
  res.send(JSON.stringify(data));
});

// 불러오기 — 파일 하나. 자료함 업로드와 달리 확장자를 가리지 않는다(우리가 만든 글 파일).
const IMPORT_MAX_MB = 20;
const importUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, _file, cb) => cb(null, `${newId()}.mmai`),
  }),
  limits: { files: 1, fileSize: IMPORT_MAX_MB * 1024 * 1024 },
});

router.post('/gm/ai/import', guard, importUpload.single('data'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '파일을 선택해 주세요' });
  const tmp = req.file.path;
  try {
    const text = await fsp.readFile(tmp, 'utf8');
    let raw;
    try { raw = JSON.parse(text); } catch { return res.status(400).json({ error: '읽을 수 없는 파일입니다' }); }

    const data = P.read(raw);
    if (!data) return res.status(400).json({ error: 'AI 자료 파일이 아닙니다' });

    const out = P.apply(req.room.id, data);
    if (out.error) return res.status(400).json(out);
    res.json(out);
  } finally {
    fs.rm(path.join(tmp), { force: true }, () => {});
  }
});

module.exports = { router };
