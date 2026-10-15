'use strict';
const CHARS = require('./chars');

/**
 * 카드 그림의 접근 권한.
 *
 * 기본은 **거부**다 (`src/modules/hooks.js`). 아래일 때만 열어 준다.
 *   - 숨기지 않은 카드의 그림
 *
 * 숨긴 카드의 그림은 열어 주지 않는다 — 카드가 있다는 사실 자체가 새면 안 된다.
 */
function fileAccess({ roomId, file }) {
  if (!roomId || !file || file.room_id !== roomId) return false;
  return CHARS.hasFile(roomId, file.id);
}

/** 자료함에서 지울 때 — 숨김 여부와 상관없이 쓰고 있으면 실물을 남긴다. */
function fileInUse(file) {
  return CHARS.usesFile(file.room_id, file.id);
}

module.exports = { fileAccess, fileInUse };
