'use strict';
const { db } = require('podam/db');
const STATE = require('podam/modules/state');
const CHARS = require('./chars');

/**
 * 👥 캐릭터 카드 — 🎲 간이 TRPG 무대에 얹혀 쓰는 **확장 모듈**.
 *
 * 자기 탭을 만들지 않는다. 무대 아래 가로줄과 무대 위 토큰 자리를 빌려 쓴다
 * (화면 쪽은 `attachTo: 'trpg'` 로 붙는다).
 * 그래서 TRPG 모듈이 꺼져 있으면 이 모듈도 아무 일도 하지 않는다.
 */
const NEEDS = 'trpg';

/** 이 모듈과 주인 모듈이 **둘 다** 켜져 있어야 한다. */
function ready(roomId) {
  const room = db.prepare('SELECT id, modules FROM rooms WHERE id = ?').get(roomId);
  return !!room && STATE.isEnabled(room, 'trpg-chars') && STATE.isEnabled(room, NEEDS);
}

module.exports = {
  id: 'trpg-chars',
  name: '👥 캐릭터 카드',
  description: '무대 아래에 캐릭터 카드를 놓고 그림·수치(HP·MP 등)·상태이상을 함께 봅니다. 🎲 간이 TRPG 와 함께 켜세요.',
  defaultOn: false,
  playerUi: true,                       // 플레이어 화면에도 카드가 보인다 (탭은 만들지 않는다)
  attachTo: NEEDS,                      // 무대 모듈에 얹힌다
  events: ['mod:trpg-chars:hello', 'mod:trpg-chars:save', 'mod:trpg-chars:tpl', 'mod:trpg-chars:place'],
  schema: require('./schema'),
  router: require('./routes').router,

  socket({ socket, on }) {
    const roomId = () => socket.data.roomId;
    const guard = (ack) => {
      if (ready(roomId())) return false;
      ack?.({ error: '사용하지 않는 기능입니다' });
      return true;
    };

    /** 들어올 때와 다시 연결될 때 한 벌. (숨긴 카드는 GM에게만) */
    on('mod:trpg-chars:hello', (_p, ack) => {
      if (guard(ack)) return;
      ack?.({
        chars: CHARS.list(roomId(), socket.data.role === 'gm'),
        statTemplate: CHARS.template(roomId()),
      });
    });

    /** 만들기·고치기·지우기·순서. 누가 무엇을 할 수 있는지는 chars.js 가 판단한다. */
    on('mod:trpg-chars:save', ({ op, char, id, ids } = {}, ack) => {
      if (guard(ack)) return;
      const who = socket.data;
      if (who.role === 'player') {
        const room = db.prepare('SELECT closed FROM rooms WHERE id = ?').get(roomId());
        if (room?.closed) return ack?.({ error: '지금은 방이 닫혀 있습니다' });
      }
      if (op === 'del') return ack?.(CHARS.remove(roomId(), who, id));
      if (op === 'order') {
        if (who.role !== 'gm') return ack?.({ error: '권한이 없습니다' });
        CHARS.reorder(roomId(), ids);
        return ack?.({ ok: true });
      }
      ack?.(CHARS.save(roomId(), who, char || {}));
    });

    /** 무대 위 토큰 자리 — 방에 있는 사람이면 누구나 옮길 수 있다. */
    on('mod:trpg-chars:place', (p = {}, ack) => {
      if (guard(ack)) return;
      ack?.(CHARS.place(roomId(), socket.data, p));
    });

    /** 방에서 쓰는 기본 항목 (새 카드가 이 틀로 만들어진다) — GM만. */
    on('mod:trpg-chars:tpl', ({ rows } = {}, ack) => {
      if (guard(ack)) return;
      if (socket.data.role !== 'gm') return ack?.({ error: '권한이 없습니다' });
      const next = CHARS.setTemplate(roomId(), rows);
      require('podam/messages').notifyEveryone(roomId(), 'chars:tpl', { statTemplate: next });
      ack?.({ ok: true, statTemplate: next });
    });
  },

  hooks: {
    // 카드 그림은 방 사람 누구나 볼 수 있다 — 단, 숨긴 카드의 그림은 막는다.
    fileAccess: require('./files').fileAccess,
    // 카드가 쓰는 그림은 자료함에서 빼도 실물을 지우지 않는다.
    fileInUse: require('./files').fileInUse,
  },

  bundle: require('./bundle'),
  guide: require('./guide'),
  ready,
};
