'use strict';
const { db } = require('podam/db');
const ASSETS = require('./assets');
const BOARD = require('./board');

/**
 * 룸 셋팅(zip)에 담기는 부분.
 *
 * **준비물만 담고 진행 기록은 담지 않는다** — 무대에 쓸 배경·음악 목록과 기본 배치까지.
 * 공용 대화는 지난 회차의 이야기이므로 담지 않는다 (정답 판정 모듈이 문답 기록을 빼는 것과 같다).
 * 음악이 켜진 상태와 지도를 띄운 상태도 빼 둔다 — 방을 열자마자 음악이 흐르면 곤란하다.
 */
function collect(roomId) {
  const b = BOARD.get(roomId);
  return {
    assets: ASSETS.list(roomId).map((a) => ({
      kind: a.kind, fileId: a.fileId, label: a.label, sortOrder: a.sortOrder,
    })),
    board: {
      bgFileId: b.bgFileId, bgmFileId: b.bgmFileId,
      bgmLoop: b.bgmLoop, bgmVolume: b.bgmVolume,
      ovFileId: b.ovFileId, ovX: b.ovX, ovY: b.ovY, ovW: b.ovW,
    },
  };
}

/** 바깥에서 들어온 값이므로 하나하나 다듬는다. 이상하면 버린다. */
function read(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const num = (v, lo, hi, dflt) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
  };
  const id = (v) => (typeof v === 'string' && /^[0-9a-f]{24}$/.test(v) ? v : null);

  const assets = (Array.isArray(raw.assets) ? raw.assets : []).slice(0, 200)
    .filter((a) => a && ASSETS.KINDS.has(a.kind) && id(a.fileId))
    .map((a) => ({
      kind: a.kind,
      fileId: id(a.fileId),
      label: a.label ? String(a.label).slice(0, 60) : null,
      sortOrder: num(a.sortOrder, 0, 999999, null),
    }));

  const b = raw.board && typeof raw.board === 'object' ? raw.board : {};
  return {
    assets,
    board: {
      bgFileId: id(b.bgFileId), bgmFileId: id(b.bgmFileId),
      bgmLoop: b.bgmLoop !== false, bgmVolume: num(b.bgmVolume, 0, 1, 0.6),
      ovFileId: id(b.ovFileId),
      ovX: num(b.ovX, 0, 1, 0.5), ovY: num(b.ovY, 0, 1, 0.5), ovW: num(b.ovW, 0.05, 1, 0.4),
    },
  };
}

/**
 * 가져오기 트랜잭션 안에서 불린다.
 * zip 안의 파일 id는 이 방에서 새 id를 받았으므로 `fileMap` 으로 바꿔 끼운다.
 * 짝을 못 찾은 것은 조용히 버린다 — 파일이 빠진 룸 셋팅이라도 나머지는 살아야 한다.
 */
function apply(roomId, data, mode, { fileMap } = {}) {
  if (!data) return 0;
  const map = (old) => (old && fileMap ? fileMap.get(old) || null : null);

  if (mode === 'replace') db.prepare('DELETE FROM trpg_assets WHERE room_id = ?').run(roomId);

  let added = 0;
  for (const a of data.assets) {
    const fresh = map(a.fileId);
    if (fresh && ASSETS.add(roomId, a.kind, fresh, a.label)) added++;
  }

  BOARD.update(roomId, {
    bgFileId: map(data.board.bgFileId),
    bgmFileId: map(data.board.bgmFileId),
    bgmPlaying: false,                       // 가져오자마자 음악이 흐르지 않게
    bgmLoop: data.board.bgmLoop,
    bgmVolume: data.board.bgmVolume,
    ovFileId: map(data.board.ovFileId),
    ovX: data.board.ovX, ovY: data.board.ovY, ovW: data.board.ovW,
    ovShown: false,
  });
  return added;
}

module.exports = { collect, read, apply };
