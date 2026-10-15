'use strict';
const ASSETS = require('./assets');
const CHAT = require('./chat');
const BOARD = require('./board');

/**
 * 「이 파일을 이 방의 플레이어가 열어도 되는가」
 *
 * 기본은 **안 된다**이다. 아래 셋 중 하나일 때만 열어 준다.
 *   1) 공용 대화가 지금도 가리키는 파일 (누군가 대화방에 올린 것)
 *   2) GM이 무대 자료 목록에 등록한 파일 (배경·BGM·지도)
 *   3) 지금 무대에 떠 있는 파일
 *
 * 셋 다 「공용으로 내놓은 것」이다. 1:1 자료함 파일은 이 길로 절대 나가지 않는다.
 * 모듈이 꺼진 방에서는 이 함수가 아예 불리지 않는다.
 */
function fileAccess({ roomId, file }) {
  if (!roomId || !file || file.room_id !== roomId) return false;
  return CHAT.hasFile(roomId, file.id)
    || ASSETS.hasFile(roomId, file.id)
    || BOARD.onStage(roomId, file.id);
}

/**
 * 「이 파일을 아직 쓰고 있는가」 — 자료함에서 지울 때 물어본다.
 * 숨긴 카드·공개 전 자료까지 **전부** 센다. 보이지 않을 뿐 쓰고 있는 것이다.
 */
function fileInUse(file) {
  const roomId = file.room_id;
  return ASSETS.hasFile(roomId, file.id) || BOARD.onStage(roomId, file.id);
}

module.exports = { fileAccess, fileInUse };
