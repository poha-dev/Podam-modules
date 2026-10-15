/* 🎲 간이 TRPG — GM 조작판
   오른쪽 칸은 좁으므로 여기서는 「무엇을 띄울지」만 고르고,
   실제 무대는 [🖥 무대 열기] 로 화면 전체에 띄운다. */
(function () {
  'use strict';

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
    side: 'gm',
    label: '🎲 TRPG',
    async mount(root, ctx) {
      try {
        await loadStage();
      } catch (e) {
        root.innerHTML = `<div class="empty">${MM.esc(e.message)}</div>`;
        return;
      }

      const esc = MM.esc;
      let assets = [];
      let board = {};

      root.innerHTML = `
        <div class="tg-ctl">
          <div class="row">
            <button class="primary tg-open grow">🖥 무대 열기</button>
            <button class="ghost tg-wide" title="1:1 대화를 옆으로 밀고 이 칸을 넓게 씁니다">⇔ 넓게</button>
          </div>

          <div class="tg-head">배경 그림 <button class="ghost tg-add" data-kind="bg">＋ 올리기</button></div>
          <div class="tg-drop" data-drop="bg"><div class="tg-grid" data-list="bg"></div></div>

          <div class="tg-head">음악 <button class="ghost tg-add" data-kind="bgm">＋ 올리기</button></div>
          <div class="tg-drop" data-drop="bgm"><div class="tg-rows" data-list="bgm"></div></div>
          <div class="row tg-bgmctl">
            <span class="faint">크기</span>
            <input type="range" class="vol grow" id="tgVol" min="0" max="100" step="5" title="모두에게 권하는 크기">
            <label class="faint"><input type="checkbox" id="tgLoop"> 반복</label>
          </div>

          <div class="tg-ext-ctl"></div>

          <div class="tg-head">공용 대화 <button class="ghost tg-clear">🧹 비우기</button></div>
        </div>
        <input type="file" class="hidden tg-assetinput" multiple>
        <div class="tg-hostwrap"></div>`;

      const $ = (s) => root.querySelector(s);
      // 조작판은 「무대 열기」 때 무대 위로 **통째로 옮겨간다**.
      // 그때는 root 밖에 있게 되므로, 조작판 안을 찾을 때는 언제나 이 함수를 쓴다.
      const c$ = (s) => ctlEl.querySelector(s);
      const ctlEl = $('.tg-ctl');
      const hostWrap = $('.tg-hostwrap');
      const host = document.createElement('div');
      host.className = 'tg-host';
      hostWrap.appendChild(host);

      const stage = TRPG.createStage(host, {
        isGm: true,
        meId: ctx.me?.().id || null,
        storeKey: `mm.trpg.gm.${ctx.room?.id || 'room'}`,
        fileUrl: (id) => `/f/${id}?gm=${encodeURIComponent(ctx.token())}`,
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
            await MM.api('/api/trpg/upload', { method: 'POST', headers: ctx.AUTH(), body: fd });
          } catch (e) { MM.toast(e.message, true); }
        },
      });

      stage.showSecretTools(true);     // 비밀 굴림은 GM만

      // ── 무대 크게 보기 ──────────────────────────────────────────────────
      // 무대도 조작판도 **옮겨 담기만** 한다. 새로 만들지 않으므로 대화도, 듣던 음악도 끊기지 않는다.
      let full = null;
      let drawerOpen = true;
      try { drawerOpen = localStorage.getItem('mm.trpg.drawer') !== '0'; } catch { }

      function openFull() {
        if (full) return;
        full = document.createElement('div');
        full.className = 'tg-full';
        full.innerHTML = `
          <div class="tg-drawer${drawerOpen ? ' open' : ''}">
            <button class="tg-drawerx" title="조작판 접기/펼치기">🎛<span class="nm">무대 조작</span></button>
            <div class="tg-drawerbody"></div>
          </div>
          <button class="tg-fullx" title="닫기 (Esc)">✕</button>`;
        full.querySelector('.tg-drawerbody').appendChild(ctlEl);   // 조작판을 무대 왼쪽 위로
        full.appendChild(host);
        document.body.appendChild(full);
        document.addEventListener('keydown', onEsc);
        stage.focus();
      }

      function closeFull() {
        if (!full) return;
        root.insertBefore(ctlEl, root.firstChild);                 // 조작판을 제자리로
        hostWrap.appendChild(host);
        full.remove();
        full = null;
        document.removeEventListener('keydown', onEsc);
      }

      const onEsc = (e) => { if (e.key === 'Escape') closeFull(); };
      c$('.tg-open').addEventListener('click', openFull);
      document.addEventListener('click', (e) => {
        if (e.target.closest('.tg-fullx')) return closeFull();
        const handle = e.target.closest('.tg-drawerx');
        if (!handle) return;
        const drawer = handle.closest('.tg-drawer');
        drawerOpen = !drawer.classList.contains('open');
        drawer.classList.toggle('open', drawerOpen);
        try { localStorage.setItem('mm.trpg.drawer', drawerOpen ? '1' : '0'); } catch { }
      });

      // ── 자료 목록 ───────────────────────────────────────────────────────
      const byKind = (k) => assets.filter((a) => a.kind === k);

      function paintAssets() {
        const bgs = byKind('bg');
        c$('[data-list="bg"]').innerHTML = bgs.length === 0
          ? '<div class="tg-hint">그림을 여기에 끌어다 놓거나<br>＋ 올리기를 누르세요.</div>'
          : bgs.map((a) => `
            <div class="tg-thumb${board.bgFileId === a.fileId ? ' on' : ''}" draggable="true"
                 data-id="${a.id}" data-asset="${a.id}" data-file="${a.fileId}"
                 title="${esc(a.label || a.name)} — 끌어서 순서를 바꿉니다">
              <img src="/f/${a.fileId}?gm=${encodeURIComponent(ctx.token())}" alt="">
              <span class="nm">${esc(a.label || a.name)}</span>
              <button class="tg-del" title="목록에서 빼기">✕</button>
            </div>`).join('');

        const bgms = byKind('bgm');
        c$('[data-list="bgm"]').innerHTML = bgms.length === 0
          ? '<div class="tg-hint">음악 파일(mp3 등)을 여기에 끌어다 놓으세요.</div>'
          : bgms.map((a) => {
            const on = board.bgmFileId === a.fileId && board.bgmPlaying;
            return `
              <div class="tg-row${on ? ' on' : ''}" draggable="true"
                   data-id="${a.id}" data-asset="${a.id}" data-file="${a.fileId}"
                   title="끌어서 순서를 바꿉니다">
                <button class="tg-play" title="${on ? '멈추기' : '틀기'}">${on ? '⏹' : '▶'}</button>
                <span class="nm">${esc(a.label || a.name)}</span>
                <button class="tg-del" title="목록에서 빼기">✕</button>
              </div>`;
          }).join('');

        c$('#tgVol').value = Math.round((board.bgmVolume ?? 0.6) * 100);
        c$('#tgLoop').checked = board.bgmLoop !== false;
      }

      function setBoard(b) {
        board = b || {};
        stage.setBoard(board);
        paintAssets();
      }

      const send = (patch) => ctx.socket.emit('mod:trpg:board', patch, (res) => {
        if (res?.error) return MM.toast(res.error, true);
        setBoard(res.board);
      });

      // 조작판에 거는 위임 — 무대 위로 옮겨가도 그대로 따라간다.
      ctlEl.addEventListener('click', (e) => {
        const del = e.target.closest('.tg-del');
        if (del) {
          e.stopPropagation();
          const id = del.closest('[data-asset]').dataset.asset;
          MM.api(`/api/gm/trpg/assets/${id}`, { method: 'DELETE', headers: ctx.AUTH() })
            .then((r) => { assets = r.assets; paintAssets(); })
            .catch((err) => MM.toast(err.message, true));
          return;
        }

        const thumb = e.target.closest('.tg-thumb');
        if (thumb) {
          const fid = thumb.dataset.file;
          send({ bgFileId: board.bgFileId === fid ? null : fid });   // 같은 것을 누르면 내린다
          return;
        }

        const play = e.target.closest('.tg-play');
        if (play) {
          const fid = play.closest('[data-file]').dataset.file;
          if (board.bgmFileId === fid && board.bgmPlaying) send({ bgmPlaying: false });
          else send({ bgmFileId: fid });
          return;
        }

        const add = e.target.closest('.tg-add');
        if (add) {
          const input = $('.tg-assetinput');
          input.dataset.kind = add.dataset.kind;
          input.accept = add.dataset.kind === 'bgm' ? 'audio/*' : 'image/*';
          input.click();
          return;
        }

        if (e.target.closest('.tg-clear')) {
          if (!confirm('공용 대화를 모두 비울까요? 모두의 화면에서 사라집니다.')) return;
          MM.api('/api/gm/trpg/clear', { method: 'POST', headers: ctx.AUTH() })
            .then(() => MM.toast('공용 대화를 비웠습니다'))
            .catch((err) => MM.toast(err.message, true));
        }
      });

      /** 배경·음악 올리기. 단추로도, 끌어다 놓기로도 같은 길을 쓴다. */
      async function upload(kind, files) {
        if (!files?.length) return;
        const fd = new FormData();
        fd.append('kind', kind);
        for (const f of files) fd.append('files', f);
        try {
          MM.toast('올리는 중…');
          const r = await MM.api('/api/gm/trpg/assets/upload', {
            method: 'POST', headers: ctx.AUTH(), body: fd,
          });
          assets = r.assets;
          paintAssets();
          MM.toast(`${r.added}개를 올렸습니다`);
        } catch (err) { MM.toast(err.message, true); }
      }

      $('.tg-assetinput').addEventListener('change', (e) => {
        const files = [...e.target.files];
        const kind = e.target.dataset.kind;
        e.target.value = '';
        upload(kind, files);
      });

      // 목록 위에 그대로 끌어다 놓으면 올라간다 (자료함과 같은 조작감).
      for (const zone of ctlEl.querySelectorAll('[data-drop]')) {
        const kind = zone.dataset.drop;
        MM.makeDropzone(zone, (files) => upload(kind, files),
          () => (kind === 'bgm' ? '여기에 놓으면 음악이 등록됩니다' : '여기에 놓으면 배경으로 등록됩니다'));
      }

      /** 목록 안에서 끌어 순서 바꾸기. 목록은 다시 그려지지만 이벤트는 칸에 걸려 있어 그대로 산다. */
      const saveOrder = (ids) => MM.api('/api/gm/trpg/assets/order', {
        method: 'PUT', headers: ctx.AUTH(), body: { ids },
      }).then((r) => { assets = r.assets; paintAssets(); })
        .catch((err) => MM.toast(err.message, true));

      MM.makeSortable(c$('[data-list="bg"]'), '.tg-thumb', saveOrder);
      MM.makeSortable(c$('[data-list="bgm"]'), '.tg-row', saveOrder);

      // TRPG를 켜 두면 GM도 이 칸을 주로 보게 된다. 1:1 대화를 옆으로 밀고 넓게 쓴다.
      c$('.tg-wide').addEventListener('click', () => {
        const on = !ctx.layout.isWide();
        ctx.layout.wide(on);
        c$('.tg-wide').classList.toggle('on', on);
        c$('.tg-wide').textContent = on ? '⇔ 좁게' : '⇔ 넓게';
      });
      if (ctx.layout?.isWide()) {
        c$('.tg-wide').classList.add('on');
        c$('.tg-wide').textContent = '⇔ 좁게';
      }

      c$('#tgVol').addEventListener('change', (e) => send({ bgmVolume: Number(e.target.value) / 100 }));
      c$('#tgLoop').addEventListener('change', (e) => send({ bgmLoop: e.target.checked }));

      // ── 서버에서 오는 것 ────────────────────────────────────────────────
      ctx.socket.on('trpg:board', (b) => setBoard(b));
      ctx.socket.on('trpg:msg', (m) => stage.addMsg(m));
      ctx.socket.on('trpg:msg:del', ({ id }) => stage.delMsg(id));
      ctx.socket.on('trpg:roll', (roll) => stage.playRoll(roll));
      ctx.socket.on('trpg:cleared', () => stage.clearLog());

      // 이 무대에 얹히기로 한 확장 모듈(캐릭터 카드 등)을 붙인다.
      for (const ext of MM.Panels.attached('trpg', 'gm')) {
        try {
          ext.mount({
            ctx, stage, isGm: true,
            slots: { ...stage.slots, ctl: c$('.tg-ext-ctl') },
            meId: ctx.me?.().id || null,
            fileUrl: (id) => `/f/${id}?gm=${encodeURIComponent(ctx.token())}`,
          });
        } catch (e) { console.warn('[모듈] 확장 화면 오류 —', e.message); }
      }

      const hello = () => ctx.socket.emit('mod:trpg:hello', {}, (res) => {
        if (!res || res.error) return;
        assets = res.assets || [];
        setBoard(res.board);
        stage.setMessages(res.messages);
      });
      hello();
      ctx.socket.on('connect', hello);
      // 누가 이름이나 이름 색을 바꾸면 지난 줄까지 새 이름·새 색으로 다시 그린다.
      ctx.socket.on('names:changed', hello);
    },
  });
})();
