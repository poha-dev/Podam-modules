'use strict';
const { db } = require('podam/db');
const M = require('podam/messages');
const BOARD = require('./board');
const CHAT = require('./chat');
const ASSETS = require('./assets');
const ROLLS = require('./rolls');

/**
 * 🎲 간이 TRPG — 모두가 같은 무대를 보고 다 같이 이야기하는 공간.
 *
 * 이 앱의 대화는 원래 GM ↔ 플레이어 1:1이다. 이 모듈만 예외로 **공용**이다.
 * 그래서 공용으로 내보낸 것(무대 자료·공용 대화)과 1:1 자료를 표부터 갈라 두었다.
 */
module.exports = {
  id: 'trpg',
  name: '🎲 간이 TRPG',
  description: '모두가 같은 배경 그림과 음악을 보고 들으며 다 같이 이야기하는 공간입니다. 주사위도 굴립니다.',
  defaultOn: false,
  playerUi: true,
  gmTab: { key: 'trpg', label: '🎲 TRPG' },
  events: ['mod:trpg:hello', 'mod:trpg:say', 'mod:trpg:del', 'mod:trpg:board', 'mod:trpg:roll'],
  schema: require('./schema'),
  router: require('./routes').router,

  socket({ socket, on }) {
    const roomId = () => socket.data.roomId;

    /**
     * 화면이 붙을 때와 다시 연결됐을 때 한 벌을 받아 간다.
     * `auth:ok`(core)를 건드리지 않으려고 모듈이 직접 물어보게 했다.
     */
    on('mod:trpg:hello', (_payload, ack) => {
      const isGm = socket.data.role === 'gm';
      ack?.({
        board: BOARD.get(roomId()),
        messages: CHAT.history(roomId()),
        assets: isGm ? ASSETS.list(roomId()) : undefined,
        rolls: ROLLS.recent(roomId(), isGm),
      });
    });

    on('mod:trpg:say', ({ text } = {}, ack) => {
      const body = String(text || '').trim().slice(0, 2000);
      if (!body) return ack?.({ error: '보낼 내용이 없습니다' });

      // 방이 닫혀 있으면 플레이어는 말할 수 없다 (1:1 대화와 같은 규칙).
      if (socket.data.role === 'player') {
        const room = db.prepare('SELECT closed FROM rooms WHERE id = ?').get(roomId());
        if (room?.closed) return ack?.({ error: '지금은 방이 닫혀 있습니다' });
      }
      const actor = CHAT.actorOf(roomId(), socket.data);
      if (!actor) return ack?.({ error: '권한이 없습니다' });
      ack?.({ ok: true, message: CHAT.add(roomId(), actor, { body }) });
    });

    on('mod:trpg:del', ({ id } = {}, ack) => {
      const err = CHAT.remove(roomId(), String(id || ''), socket.data);
      ack?.(err ? { error: err } : { ok: true });
    });

    /**
     * 주사위. 눈은 서버가 정하고, 화면은 그 값으로 굴러가는 모습만 보여 준다.
     * 그래야 모두가 같은 숫자를 본다.
     */
    on('mod:trpg:roll', ({ notation, stage, secret, strength } = {}, ack) => {
      const actor = CHAT.actorOf(roomId(), socket.data);
      if (!actor) return ack?.({ error: '권한이 없습니다' });
      const out = ROLLS.make(roomId(), actor, {
        text: notation, stage, strength,
        secret: socket.data.role === 'gm' && !!secret,   // 비밀 굴림은 GM만
      });
      ack?.(out.error ? { error: out.error } : { ok: true, roll: out.roll });
    });

    /** 무대를 바꾸는 것은 GM만. */
    on('mod:trpg:board', (patch = {}, ack) => {
      if (socket.data.role !== 'gm') return ack?.({ error: '권한이 없습니다' });
      ack?.({ ok: true, board: BOARD.update(roomId(), patch) });
    });
  },

  hooks: {
    // 공용으로 내놓은 파일만 방 사람 모두에게 열어 준다 (files.js 참고).
    fileAccess: require('./files').fileAccess,
    // 무대가 쓰고 있는 파일은 자료함에서 빼도 실물을 지우지 않는다.
    fileInUse: require('./files').fileInUse,
  },

  bundle: require('./bundle'),
  guide: require('./guide'),
};
