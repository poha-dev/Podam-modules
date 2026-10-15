'use strict';
const { db } = require('podam/db');

/**
 * 파일 권한.
 *
 * 이 모듈은 **아무것도 내주지 않는다** — `fileAccess` 를 아예 두지 않았다.
 * 시나리오 원본은 GM만 보는 것이고, 플레이어에게는 기본 거부가 그대로 적용된다.
 *
 * 다만 자료함에서 파일을 지울 때는 「아직 쓰는 중」이라고 알려 줘야 한다.
 * 원본이 사라지면 자료를 다시 읽을 수 없기 때문이다.
 */
function fileInUse(file) {
  return !!db.prepare('SELECT 1 FROM ai_docs WHERE file_id = ? AND room_id = ?')
    .get(file.id, file.room_id);
}

module.exports = { fileInUse };
