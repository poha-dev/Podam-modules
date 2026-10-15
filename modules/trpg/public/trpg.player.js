/* 🎲 간이 TRPG — 플레이어 화면
   방에 있는 모두가 같은 무대를 보고 함께 이야기한다. GM과의 1:1 대화와는 별개다. */
(function () {
  'use strict';

  /** 무대 그리는 코드는 GM 쪽과 같은 파일을 쓴다. 한 번만 불러온다. */
  function loadStage() {
    if (window.TRPG) return Promise.resolve();
    if (!loadStage.p) {
      loadStage.p = new Promise((resolve, reject) => {
        const el = document.createElement('script');
        el.src = '/modules/trpg.stage.js';
        el.onload = resolve;
        el.onerror = () => reject(new Error('무대 화면을 불러오지 못했습니다'));
        document.head.appendChild(el);
      });
    }
    return loadStage.p;
  }

  MM.Panels.define({
    id: 'trpg',
    side: 'player',
    label: '🎲 TRPG',
    async mount(root, ctx) {
      try {
        await loadStage();
      } catch (e) {
        root.innerHTML = `<div class="empty">${MM.esc(e.message)}</div>`;
        return;
      }

      const token = () => ctx.headers()['x-player-token'] || '';
      const box = document.createElement('div');
      box.className = 'tg-host';
      root.appendChild(box);

      const stage = TRPG.createStage(box, {
        isGm: false,
        meId: ctx.me?.id,
        storeKey: `mm.trpg.${ctx.me?.id || 'me'}`,
        fileUrl: (id) => `/f/${id}?t=${encodeURIComponent(token())}`,
        onSay: (text) => ctx.socket.emit('mod:trpg:say', { text }, (res) => {
          if (res?.error) MM.toast(res.error, true);
        }),
        onDelete: (id) => ctx.socket.emit('mod:trpg:del', { id }, (res) => {
          if (res?.error) MM.toast(res.error, true);
        }),
        onRoll: (payload) => ctx.socket.emit('mod:trpg:roll', payload, (res) => {
          if (res?.error) MM.toast(res.error, true);
        }),
        onFiles: async (files) => {
          const fd = new FormData();
          for (const f of files) fd.append('files', f);
          try {
            await MM.api('/api/trpg/upload', { method: 'POST', headers: ctx.headers(), body: fd });
          } catch (e) { MM.toast(e.message, true); }
        },
      });

      /** 들어올 때와 다시 연결될 때 한 벌을 받는다 (재접속도 이 길로 해결된다). */
      // 이 무대에 얹히기로 한 확장 모듈(캐릭터 카드 등)을 붙인다.
      for (const ext of MM.Panels.attached('trpg', 'player')) {
        try {
          ext.mount({ ctx, stage, slots: stage.slots, isGm: false, meId: ctx.me?.id, fileUrl: (id) => `/f/${id}?t=${encodeURIComponent(token())}` });
        } catch (e) { console.warn('[모듈] 확장 화면 오류 —', e.message); }
      }

      const hello = () => ctx.socket.emit('mod:trpg:hello', {}, (res) => {
        if (!res || res.error) return;
        stage.setBoard(res.board);
        stage.setMessages(res.messages);
      });
      hello();
      ctx.socket.on('connect', hello);
      // 누가 이름이나 이름 색을 바꾸면 지난 줄까지 새 이름·새 색으로 다시 그린다.
      ctx.socket.on('names:changed', hello);

      ctx.socket.on('trpg:board', (b) => stage.setBoard(b));
      ctx.socket.on('trpg:msg', (m) => stage.addMsg(m));
      ctx.socket.on('trpg:msg:del', ({ id }) => stage.delMsg(id));
      ctx.socket.on('trpg:roll', (roll) => stage.playRoll(roll));
      ctx.socket.on('trpg:cleared', () => stage.clearLog());

      // 이 탭으로 넘어오면 바로 칠 수 있게 커서를 둔다.
      document.getElementById('ptabs')?.addEventListener('click', (e) => {
        if (e.target.closest('[data-ptab="trpg"]')) setTimeout(() => stage.focus(), 50);
      });
    },
  });
})();
