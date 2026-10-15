'use strict';
const E = require('./engine');

/**
 * 🔑 정답 판정 — 배역마다 「정답:답변」 짝을 등록해 두면,
 * 그 배역을 맡은 플레이어가 정답을 내는 순간 짝지어진 답변이 자동으로 나간다.
 * 같은 정답이라도 배역이 다르면 다른 답변이 나갈 수 있다.
 *
 * 플레이어는 GM 대화가 아니라 전용 탭에서 제출한다 — 명령어를 외울 필요가 없다.
 */
module.exports = {
  id: 'verdict',
  name: '🔑 정답 판정',
  description: '배역마다 「정답:답변」 표를 등록해 두면, 플레이어가 정답을 냈을 때 그 답변이 자동으로 나갑니다.',
  defaultOn: false,
  playerUi: true,                       // 플레이어에게 제출 탭이 생긴다
  gmTab: { key: 'verdict', label: '🔑 정답표' },
  events: ['mod:verdict:ask'],
  schema: require('./schema'),
  router: require('./routes').router,

  /** 플레이어의 제출을 받는 곳. 모듈이 꺼져 있으면 여기까지 오지 않는다. */
  socket({ socket, on }) {
    on('mod:verdict:ask', ({ text } = {}, ack) => {
      if (socket.data.role !== 'player') return ack?.({ error: '권한이 없습니다' });
      ack?.(E.submit({
        roomId: socket.data.roomId,
        participantId: socket.data.participantId,
        text,
      }));
    });
  },

  bundle: require('./bundle'),
  guide: require('./guide'),
};
