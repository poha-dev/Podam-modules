'use strict';
const { db } = require('podam/db');
const M = require('podam/messages');

/**
 * 무대 상태 — 지금 어떤 배경이 떠 있고 어떤 곡이 흐르는지.
 *
 * 컨테이너가 다시 떠도, 늦게 들어온 사람도 같은 화면을 봐야 하므로 DB에 둔다.
 * 바뀔 때마다 **통째로** 방송한다. 조각만 보내면 화면마다 다른 상태로 어긋난다.
 */

const EMPTY = {
  bgFileId: null, bgmFileId: null, bgmPlaying: false, bgmLoop: true,
  bgmVolume: 0.6, bgmStartedAt: null,
  ovFileId: null, ovX: 0.5, ovY: 0.5, ovW: 0.4, ovShown: false,
};

const row = (roomId) => db.prepare('SELECT * FROM trpg_board WHERE room_id = ?').get(roomId);

const view = (r) => (!r ? { ...EMPTY } : {
  bgFileId: r.bg_file_id || null,
  bgmFileId: r.bgm_file_id || null,
  bgmPlaying: !!r.bgm_playing,
  bgmLoop: !!r.bgm_loop,
  bgmVolume: r.bgm_volume,
  bgmStartedAt: r.bgm_started_at || null,
  ovFileId: r.ov_file_id || null,
  ovX: r.ov_x, ovY: r.ov_y, ovW: r.ov_w,
  ovShown: !!r.ov_shown,
});

const get = (roomId) => view(row(roomId));

const clamp = (v, lo, hi, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

/** 이 방이 가진 파일인지 확인한다. 남의 방 파일을 무대에 올릴 수 없다. */
function ownFile(roomId, fileId) {
  if (!fileId) return null;
  const f = db.prepare('SELECT id FROM files WHERE id = ? AND room_id = ?').get(String(fileId), roomId);
  return f ? f.id : null;
}

/**
 * GM이 무대를 바꾼다. 준 것만 바뀌고 나머지는 그대로다.
 * 돌려주는 값은 바뀐 뒤의 무대 전체.
 */
function update(roomId, patch = {}) {
  const now = get(roomId);
  const next = { ...now };

  if ('bgFileId' in patch) next.bgFileId = ownFile(roomId, patch.bgFileId);
  if ('ovFileId' in patch) next.ovFileId = ownFile(roomId, patch.ovFileId);

  if ('bgmFileId' in patch) {
    next.bgmFileId = ownFile(roomId, patch.bgmFileId);
    // 곡을 바꾸면 재생 위치도 처음부터다.
    next.bgmStartedAt = next.bgmFileId ? Date.now() : null;
    next.bgmPlaying = !!next.bgmFileId;
  }
  if ('bgmPlaying' in patch) {
    next.bgmPlaying = !!patch.bgmPlaying && !!next.bgmFileId;
    if (next.bgmPlaying && !now.bgmPlaying) next.bgmStartedAt = Date.now();
    if (!next.bgmPlaying) next.bgmStartedAt = null;
  }
  if ('bgmLoop' in patch) next.bgmLoop = !!patch.bgmLoop;
  if ('bgmVolume' in patch) next.bgmVolume = clamp(patch.bgmVolume, 0, 1, now.bgmVolume);

  if ('ovX' in patch) next.ovX = clamp(patch.ovX, 0, 1, now.ovX);
  if ('ovY' in patch) next.ovY = clamp(patch.ovY, 0, 1, now.ovY);
  if ('ovW' in patch) next.ovW = clamp(patch.ovW, 0.05, 1, now.ovW);
  if ('ovShown' in patch) next.ovShown = !!patch.ovShown && !!next.ovFileId;

  db.prepare(`INSERT INTO trpg_board
      (room_id, bg_file_id, bgm_file_id, bgm_playing, bgm_loop, bgm_volume, bgm_started_at,
       ov_file_id, ov_x, ov_y, ov_w, ov_shown, updated_at)
    VALUES (@room_id, @bg, @bgm, @playing, @loop, @volume, @started,
            @ov, @x, @y, @w, @shown, @at)
    ON CONFLICT(room_id) DO UPDATE SET
      bg_file_id=@bg, bgm_file_id=@bgm, bgm_playing=@playing, bgm_loop=@loop,
      bgm_volume=@volume, bgm_started_at=@started,
      ov_file_id=@ov, ov_x=@x, ov_y=@y, ov_w=@w, ov_shown=@shown, updated_at=@at`)
    .run({
      room_id: roomId,
      bg: next.bgFileId, bgm: next.bgmFileId,
      playing: next.bgmPlaying ? 1 : 0, loop: next.bgmLoop ? 1 : 0,
      volume: next.bgmVolume, started: next.bgmStartedAt,
      ov: next.ovFileId, x: next.ovX, y: next.ovY, w: next.ovW,
      shown: next.ovShown ? 1 : 0, at: Date.now(),
    });

  M.notifyEveryone(roomId, 'trpg:board', next);
  return next;
}

/** 무대에 올라와 있는 파일인지 (파일 권한 판정에 쓴다). */
function onStage(roomId, fileId) {
  const r = row(roomId);
  if (!r) return false;
  return r.bg_file_id === fileId || r.bgm_file_id === fileId || r.ov_file_id === fileId;
}

module.exports = { get, update, onStage };
