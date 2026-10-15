/* 🔑 정답 판정 — 플레이어 화면
   GM과의 대화와 섞이지 않게, 정답만 내는 칸을 따로 둔다. */
(function () {
  'use strict';

  MM.Panels.define({
    id: 'verdict',
    side: 'player',
    label: '🔑 정답 제출',
    mount(root, ctx) {
      const log = [];                        // 이 화면에서 주고받은 것 (내 브라우저에만)
      const stars = ctx.stars;               // 대화 탭과 같은 즐겨찾기를 쓴다

      root.innerHTML = `
        <div class="vp-wrap">
          <div class="vp-help">
            알아낸 <b>단어나 이름</b>을 넣어 보세요. 맞으면 바로 답이 돌아옵니다.
            <span class="faint">여기 적은 것은 GM에게만 갑니다. 다른 플레이어는 볼 수 없습니다.</span>
          </div>
          <div class="vp-form">
            <input id="vpInput" placeholder="예: 타임루프" maxlength="200" autocomplete="off">
            <button class="primary" id="vpSend">제출</button>
          </div>
          <div id="vpLog" class="vp-log"></div>
        </div>`;

      const logEl = root.querySelector('#vpLog');
      const input = root.querySelector('#vpInput');

      function paintLog() {
        logEl.innerHTML = log.length === 0
          ? '<div class="empty">낸 정답이 여기에 쌓입니다.<br>답변은 대화 탭에도 그대로 남습니다.</div>'
          : log.map((r, i) => `
            <div class="vp-item${r.matched ? ' ok' : ''}">
              <div class="vp-q">${MM.esc(r.text)}</div>
              <div class="vp-a">${r.matched ? MM.esc(r.reply || '답변이 도착했습니다') : '아직 알아낸 것이 없습니다'}</div>
              ${r.matched && r.messageId
                ? `<button class="star${stars?.has(r.messageId) ? ' on' : ''}" data-star="${i}"
                     title="즐겨찾기">★</button>`
                : ''}
            </div>`).join('');
      }

      // 답변 말풍선을 붙잡아 둔다 — ★ 즐겨찾기가 대화 탭과 같은 곳에 담기게.
      // 말풍선이 제출 응답보다 먼저 올 수도 있어, 온 순서대로 쌓아 두고 짝을 맞춘다.
      const waiting = [];
      const attach = () => {
        for (const row of [...log].reverse()) {          // 낸 순서대로
          if (row.matched && !row.msg && waiting.length) {
            row.msg = waiting.shift();
            row.messageId = row.msg.id;
          }
        }
        paintLog();
      };
      ctx.socket?.on('message', (m) => {
        if (m.kind !== 'vans') return;
        waiting.push(m);
        attach();
      });

      logEl.addEventListener('click', (e) => {
        const idx = e.target.dataset?.star;
        if (idx === undefined || !stars) return;
        const row = log[Number(idx)];
        if (!row?.msg) return;
        const on = stars.toggle(row.msg);
        e.target.classList.toggle('on', on);
        ctx.refreshStars?.();
        MM.toast(on ? '즐겨찾기에 담았습니다' : '즐겨찾기에서 뺐습니다');
      });
      paintLog();

      async function send() {
        const text = input.value.trim();
        if (!text) return;
        input.disabled = true;
        ctx.socket.emit('mod:verdict:ask', { text }, (res) => {
          input.disabled = false;
          input.focus();
          if (res?.error) return MM.toast(res.error, true);
          input.value = '';
          log.unshift({ text, matched: !!res.matched, reply: res.reply });
          attach();                                       // 이미 도착한 말풍선이 있으면 여기서 이어붙는다
        });
      }

      root.querySelector('#vpSend').addEventListener('click', send);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); send(); }
      });

      // 이 탭으로 넘어오면 바로 칠 수 있게 커서를 둔다.
      document.getElementById('ptabs')?.addEventListener('click', (e) => {
        if (e.target.closest('[data-ptab="verdict"]')) setTimeout(() => input.focus(), 50);
      });
    },
  });
})();
