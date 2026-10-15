/* 🎲 간이 TRPG — 무대 화면 (GM·플레이어가 같은 코드를 쓴다)
   배경 그림이 화면을 가득 채우고, 주고받은 말은 **그림 위에 겹쳐** 뜬다.
   말풍선은 5초 뒤 스르르 옅어지고, 대화 쪽에 마우스를 올리거나 입력칸을 누르면
   다시 또렷해진다 — 그림을 가리지 않으면서도 언제든 지난 말을 볼 수 있게 하려는 것이다. */
(function (global) {
  'use strict';

  const FADE_MS = 5000;          // 새 말이 뜬 뒤 옅어지기까지

  /**
   * @param {HTMLElement} root  무대를 그릴 곳
   * @param {object} o
   *   isGm     — GM인가 (말풍선 색과 지울 수 있는 범위가 달라진다)
   *   meId     — 내 참가자/GM id (내 말풍선을 오른쪽에 붙이려고)
   *   fileUrl  — (fileId) => URL
   *   storeKey — 이 브라우저에 설정을 남길 때 쓰는 열쇠
   *   onSay(text) · onFiles(File[]) · onDelete(id)
   */
  function createStage(root, o) {
    const esc = MM.esc;
    let board = null;
    let msgs = [];

    root.classList.add('tg-wrap');
    root.innerHTML = `
      <div class="tg-stage">
        <img class="tg-bg hidden" alt="">
        <div class="tg-empty">아직 띄운 그림이 없습니다.</div>

        <div class="tg-chat">
          <div class="tg-log"></div>
        </div>
        <button class="tg-pin" title="대화 계속 보기 / 자동으로 숨기기">💬</button>

        <div class="tg-ext-layer"></div>
        <div class="tg-dicebox"></div>

        <div class="tg-sound hidden">
          <button class="primary tg-unmute">🔊 소리 켜기</button>
        </div>
        <div class="tg-vol hidden">
          <span title="이 크기는 내 화면에만 적용됩니다">🎵</span>
          <input type="range" class="vol" min="0" max="100" step="5">
        </div>
      </div>
      <div class="tg-ext-below"></div>
      <div class="tg-tray hidden">
        ${[3, 4, 6, 8, 10, 12, 20, 100].map((n) => `
          <button class="tg-die" data-sides="${n}" title="누르면 +1 · 오른쪽 단추로 -1">
            <span class="cnt">0</span>d${n}
          </button>`).join('')}
        <button class="ghost tg-reset" title="담은 것 비우기">↺</button>
        <button class="primary tg-roll" title="누르고 있으면 힘 조절">roll!</button>
        <label class="tg-secret hidden" title="나만 결과를 봅니다">
          <input type="checkbox"> 🤫 비밀
        </label>
        <div class="tg-power hidden">
          <svg viewBox="0 0 120 64" aria-hidden="true">
            <path class="arc" d="M10 58 A50 50 0 0 1 110 58" fill="none" stroke-width="11"/>
            <path class="arcwarm" d="M10 58 A50 50 0 0 1 110 58" fill="none" stroke-width="11"/>
            <path class="archot" d="M10 58 A50 50 0 0 1 110 58" fill="none" stroke-width="13"/>
            <line class="needle" x1="60" y1="58" x2="60" y2="10" stroke-width="5"/>
          </svg>
          <span class="step">1</span>
        </div>
      </div>
      <div class="tg-composer">
        <button class="ghost tg-dicebtn" title="주사위 판 열기/닫기">🎲</button>
        <button class="ghost tg-file" title="파일 올리기 (끌어다 놓거나 Ctrl+V 도 됩니다)">📎</button>
        <input type="file" class="hidden tg-fileinput" multiple>
        <textarea class="tg-input grow" rows="1" placeholder="모두에게 보낼 말 (Enter 전송 · /1d20+3 으로 주사위)"></textarea>
        <button class="primary tg-send">보내기</button>
      </div>`;

    const $ = (sel) => root.querySelector(sel);
    const stageEl = $('.tg-stage');
    const bgEl = $('.tg-bg');
    const emptyEl = $('.tg-empty');
    const chatEl = $('.tg-chat');
    const logEl = $('.tg-log');
    const inputEl = $('.tg-input');
    const volEl = $('.tg-vol input');
    const pinEl = $('.tg-pin');

    // ── 음악 ────────────────────────────────────────────────────────────────
    // 긴 곡을 반복 재생해야 하므로 MM.Sound(한 번 울리는 소리)가 아니라 <audio>를 쓴다.
    const audio = new Audio();
    audio.loop = true;
    audio.preload = 'none';
    let myVol = 0.8;
    try { myVol = Number(localStorage.getItem(`${o.storeKey}.vol`) ?? 0.8); } catch { }
    volEl.value = Math.round(myVol * 100);

    const applyVolume = () => {
      audio.volume = Math.max(0, Math.min(1, (board?.bgmVolume ?? 0.6) * myVol));
    };
    volEl.addEventListener('input', () => {
      myVol = Number(volEl.value) / 100;
      applyVolume();
      try { localStorage.setItem(`${o.storeKey}.vol`, String(myVol)); } catch { }
    });

    /** 자동 재생은 사람이 한 번 눌러 주기 전까지 브라우저가 막는다. 막히면 단추를 띄운다. */
    function tryPlay() {
      const p = audio.play();
      if (p?.catch) {
        p.then(() => $('.tg-sound').classList.add('hidden'))
          .catch(() => $('.tg-sound').classList.remove('hidden'));
      }
    }
    $('.tg-unmute').addEventListener('click', () => {
      MM.Sound.unlock?.();
      tryPlay();
    });

    function paintBgm() {
      const on = !!(board?.bgmPlaying && board?.bgmFileId);
      $('.tg-vol').classList.toggle('hidden', !on);
      if (!on) {
        audio.pause();
        audio.removeAttribute('src');
        audio.dataset.src = '';
        $('.tg-sound').classList.add('hidden');
        return;
      }
      const url = o.fileUrl(board.bgmFileId);
      if (audio.dataset.src !== url) {
        audio.dataset.src = url;
        audio.src = url;
        // 늦게 들어온 사람은 대충 그 지점부터 듣는다. 정확히 맞추는 것은 필요도 없고 되지도 않는다.
        const skip = board.bgmStartedAt ? (Date.now() - board.bgmStartedAt) / 1000 : 0;
        audio.addEventListener('loadedmetadata', () => {
          if (skip > 1 && Number.isFinite(audio.duration) && audio.duration > 1) {
            audio.currentTime = skip % audio.duration;
          }
        }, { once: true });
      }
      audio.loop = !!board.bgmLoop;
      applyVolume();
      if (audio.paused) tryPlay();
    }

    // ── 무대 ────────────────────────────────────────────────────────────────
    function setBoard(next) {
      board = next || null;
      const bg = board?.bgFileId;
      bgEl.classList.toggle('hidden', !bg);
      emptyEl.classList.toggle('hidden', !!bg);
      if (bg) {
        const url = o.fileUrl(bg);
        if (bgEl.getAttribute('src') !== url) bgEl.src = url;
      } else {
        bgEl.removeAttribute('src');
      }
      paintBgm();
    }

    // ── 말풍선 보이기/숨기기 ────────────────────────────────────────────────
    // 그림을 가리지 않는 것이 목적이므로, 평소에는 옅어졌다가
    //   ① 대화 위에 마우스를 올리거나 ② 입력칸을 누르거나 ③ 휠을 굴리거나
    //   ④ 💬 로 고정하면
    // 다시 또렷해진다.
    let sleepTimer = null;
    let pinned = false;
    try { pinned = localStorage.getItem(`${o.storeKey}.pin`) === '1'; } catch { }

    function wake(hold) {
      chatEl.classList.add('awake');
      clearTimeout(sleepTimer);
      if (!hold && !pinned) sleepTimer = setTimeout(sleep, FADE_MS);
    }
    function sleep() {
      if (pinned) return;
      chatEl.classList.remove('awake');
      chatEl.scrollTop = chatEl.scrollHeight;     // 다시 뜰 때는 맨 아래가 보이게
    }
    function paintPin() {
      pinEl.classList.toggle('on', pinned);
      pinEl.title = pinned ? '대화를 자동으로 숨기기' : '대화 계속 보기';
      if (pinned) wake(true); else wake();
    }
    pinEl.addEventListener('click', () => {
      pinned = !pinned;
      try { localStorage.setItem(`${o.storeKey}.pin`, pinned ? '1' : '0'); } catch { }
      paintPin();
    });

    chatEl.addEventListener('pointerenter', () => wake(true));
    chatEl.addEventListener('pointerleave', () => wake());
    chatEl.addEventListener('wheel', () => wake(true), { passive: true });
    inputEl.addEventListener('focus', () => wake(true));
    inputEl.addEventListener('blur', () => wake());

    // ── 대화 ────────────────────────────────────────────────────────────────
    const isMine = (m) => (m.sender === 'gm' ? o.isGm && m.gmId === o.meId : m.participantId === o.meId);

    function attachmentHtml(file) {
      const url = o.fileUrl(file.id);
      const head = `<a class="att" href="${url}" target="_blank" rel="noopener">`
        + `<span class="ico">${MM.iconFor(file.mime)}</span>`
        + `<span class="nm">${esc(file.name)}</span>`
        + `<span class="faint">${MM.sizeOf(file.size)}</span></a>`;
      if (file.mime.startsWith('image/')) {
        return head + `<img class="att-img" src="${url}" data-full="${url}" data-name="${esc(file.name)}" alt="">`;
      }
      return head;
    }

    /** 주사위 결과는 「굴린 사람이 말하는」 모양으로 보여 준다. */
    function diceHtml(m) {
      const d = m.meta || {};
      if (!d.notation) return esc(m.body || '');           // 예전 줄은 글 그대로
      return '<span class="dice-tag">🎲 다이스 판정</span>'
        + (m.secret ? '<span class="dice-tag secret">🤫 나만 보임</span>' : '')
        + `<span class="dice-expr">${esc(d.notation)} = ${esc(d.detail)}</span>`
        + `<span class="dice-total">${esc(String(d.total))}</span>`;
    }

    function bubbleHtml(m) {
      const mine = isMine(m);
      if (m.sender === 'system') {
        return `<div class="msg system" data-tgid="${m.id}">${esc(m.body || '')}</div>`;
      }
      const cls = ['msg', mine ? 'mine' : 'theirs'];
      if (m.sender === 'gm') cls.push('gmchat');         // GM 말은 노란색으로 눈에 띄게
      if (m.kind === 'dice') cls.push('dice');
      const canDel = mine || o.isGm;
      const name = m.nickname || (m.sender === 'gm' ? 'GM' : '?');
      // 이름에 이미 GM이 들어 있으면 딱지를 또 붙이지 않는다 ("GM GM" 방지).
      const badge = m.sender === 'gm' && !/gm/i.test(name) ? ' <span class="tg-badge">GM</span>' : '';
      // 이름 색은 각자 고른 것이다 (서버가 #rrggbb 만 통과시킨다).
      const col = m.color ? ` style="color:${m.color}"` : '';
      return `<div class="${cls.join(' ')}" data-tgid="${m.id}">`
        + `<span class="who"${col}>${esc(name)}${badge}</span>`
        + (m.kind === 'dice' ? diceHtml(m) : (m.body ? `${esc(m.body)}` : ''))
        + (m.file ? attachmentHtml(m.file) : '')
        + `<span class="stamp">${MM.timeOf(m.createdAt)}</span>`
        + (canDel ? '<button class="tg-x" title="지우기">×</button>' : '')
        + '</div>';
    }

    const toBottom = () => { chatEl.scrollTop = chatEl.scrollHeight; };

    function paintLog() {
      logEl.innerHTML = msgs.map(bubbleHtml).join('');
      MM.enableLightbox(logEl);
    }

    function setMessages(list) {
      msgs = list || [];
      paintLog();
      toBottom();
      wake();
    }

    function addMsg(m) {
      if (msgs.some((x) => x.id === m.id)) return;
      msgs.push(m);
      if (msgs.length > 300) msgs = msgs.slice(-300);   // 화면이 무거워지지 않게
      paintLog();
      toBottom();
      wake();                                           // 새 말이 오면 잠깐 또렷해진다
    }

    function delMsg(id) {
      msgs = msgs.filter((m) => m.id !== id);
      paintLog();
    }

    logEl.addEventListener('click', (e) => {
      const x = e.target.closest('.tg-x');
      if (!x) return;
      const id = x.closest('[data-tgid]')?.dataset.tgid;
      if (id && confirm('이 줄을 지울까요? 모두의 화면에서 사라집니다.')) o.onDelete?.(id);
    });

    // ── 확장 모듈이 얹히는 자리 ─────────────────────────────────────────────
    // 캐릭터 카드처럼 무대 위에 얹혀 쓰는 모듈에게 빌려주는 칸이다.
    // 무대가 통째로 옮겨 다녀도(전체 화면) 함께 따라가도록 무대 안에 둔다.
    const slots = {
      below: $('.tg-ext-below'),        // 무대 아래 가로줄
      layer: $('.tg-ext-layer'),        // 무대 위(배경 그림 위)에 겹치는 칸
      stageEl,
    };

    /**
     * 배경 그림이 무대 안에서 **실제로 차지하는 사각형**.
     *
     * 배경은 `object-fit: contain` 이라 화면 비율에 따라 위아래(또는 좌우)에 빈 자리가 생긴다.
     * 무대 전체를 기준으로 토큰 자리를 잡으면 **사람마다 그림 위의 다른 지점**을 가리키게 되므로,
     * 언제나 이 사각형을 기준으로 비율을 계산한다.
     */
    function artRect() {
      const w = stageEl.clientWidth;
      const h = stageEl.clientHeight;
      const nw = bgEl.naturalWidth;
      const nh = bgEl.naturalHeight;
      if (!nw || !nh || bgEl.classList.contains('hidden')) {
        return { left: 0, top: 0, w, h };             // 배경이 없으면 무대 전체
      }
      const k = Math.min(w / nw, h / nh);
      const aw = nw * k;
      const ah = nh * k;
      return { left: (w - aw) / 2, top: (h - ah) / 2, w: aw, h: ah };
    }

    // 배경이 바뀌거나 무대 크기가 달라지면 얹힌 것들이 자리를 다시 잡아야 한다.
    const artWatchers = [];
    const notifyArt = () => { for (const fn of artWatchers) { try { fn(artRect()); } catch { } } };
    bgEl.addEventListener('load', notifyArt);
    if (window.ResizeObserver) {
      let at = null;
      new ResizeObserver(() => { clearTimeout(at); at = setTimeout(notifyArt, 120); }).observe(stageEl);
    }

    // ── 주사위 ──────────────────────────────────────────────────────────────
    // 눈은 서버가 정한다. 여기서는 **그 값으로 굴러가는 모습**만 보여 준다.
    // 그래서 모두의 화면에 같은 숫자가 뜬다 (구르는 길은 저마다 다르다).

    const DICE_COLORS = {                      // 종류마다 색이 다르면 한눈에 구분된다
      d4: { dice: '#2f6b46', label: '#e8ffef' },
      d6: { dice: '#2f4179', label: '#e9edff' },
      d8: { dice: '#5f3a78', label: '#f6e9ff' },
      d10: { dice: '#1f6068', label: '#e2fbff' },
      d12: { dice: '#7a5a1f', label: '#fff3da' },
      d20: { dice: '#8a2f3a', label: '#ffe9ec' },
      d100: { dice: '#39404a', label: '#eef2f7' },
    };
    const VENDOR = '/vendor/dice/';
    const diceBox = $('.tg-dicebox');
    let box = null;                            // DICE.dice_box
    let diceReady = null;                      // 불러오기 약속 (한 번만)
    let rolling = false;
    const waiting = [];                        // 굴림이 겹치면 차례로

    const loadScript = (src) => new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src;
      el.onload = resolve;
      el.onerror = () => reject(new Error(src));
      document.head.appendChild(el);
    });

    /** 무대가 화면에 떠 있고 크기가 잡혀 있는가 (숨어 있으면 0이다). */
    const stageVisible = () => diceBox.clientWidth > 40 && diceBox.clientHeight > 40;

    /** 3D 주사위는 무거우므로 **처음 굴릴 때** 불러온다. 실패하면 숫자만 보여 준다. */
    function ensureDice() {
      if (diceReady) return diceReady;
      // 숨겨진 칸에서 만들면 판 크기가 0이라 주사위가 보이지 않는다.
      // (GM은 다른 탭을 보다가 남의 굴림을 먼저 받는 일이 흔하다.)
      if (!stageVisible()) return Promise.resolve(false);
      diceReady = (async () => {
        if (!window.WebGLRenderingContext) throw new Error('이 브라우저는 3D를 못 씁니다');
        // 이 라이브러리들은 const 로 선언돼 window 에 붙지 않는 것도 있어, 이름으로 확인한다.
        if (typeof THREE === 'undefined') await loadScript(`${VENDOR}three.min.js`);
        if (typeof CANNON === 'undefined') await loadScript(`${VENDOR}cannon.min.js`);
        if (typeof $t === 'undefined') await loadScript(`${VENDOR}teal.js`);
        if (typeof DICE === 'undefined') await loadScript(`${VENDOR}dice.js`);
        DICE.colors = DICE_COLORS;
        DICE.size_factor = 0.5;                  // 기본 크기는 무대에 비해 너무 크다
        DICE.sound_url = `${VENDOR}dicesound.mp3`;
        box = new DICE.dice_box(diceBox);
        return true;
      })().catch((e) => {
        console.warn('[TRPG] 3D 주사위를 쓸 수 없습니다 —', e.message);
        return false;
      });
      return diceReady;
    }

    // 무대 크기가 바뀌면 굴리는 판도 다시 맞춘다 (전체 화면으로 열 때 등).
    if (window.ResizeObserver) {
      let t = null;
      new ResizeObserver(() => {
        clearTimeout(t);
        t = setTimeout(() => {
          if (box && !rolling && stageVisible()) box.reinit(diceBox);
        }, 200);
      }).observe(diceBox);
    }

    /**
     * 서버가 준 눈을 라이브러리가 쓰는 표기로 바꾼다.
     * d100 은 이 라이브러리에서 십의 자리(00~90)와 일의 자리(d9) 두 알로 굴린다.
     */
    function visualOf(dice) {
      const terms = [], values = [];
      for (const d of dice) {
        if (d.sides === 100) {
          terms.push('1d100', '1d9');
          values.push(Math.floor((d.value % 100) / 10), d.value % 10);   // 100 → 0,0 (=00+0)
        } else {
          terms.push(`1d${d.sides}`);
          values.push(d.value);
        }
      }
      return { notation: terms.join('+'), values };
    }

    /** 굴림 하나를 보여 준다. 다 구르면 결과 말풍선이 뜨고, 3초 뒤 주사위는 사라진다. */
    async function playRoll(roll) {
      if (rolling) { waiting.push(roll); return; }
      rolling = true;

      const done = () => {
        rolling = false;
        showRollMessage(roll);
        const next = waiting.shift();
        if (next) playRoll(next);
      };

      // The bundled 3D library has no d3 mesh. The authoritative result is
      // still shown immediately as a message instead of attempting a broken animation.
      const hasUnsupportedVisual = roll.dice?.some((d) => d.sides === 3);
      const ok = !hasUnsupportedVisual && stageVisible() && await ensureDice();
      if (!ok || !box || !roll.dice?.length) return done();
      if (box.rolling) return done();                       // 아직 구르는 중이면 결과만

      const v = visualOf(roll.dice);
      const biggest = Math.max(...roll.dice.map((d) => d.sides));
      DICE.sound_rate = biggest >= 20 ? 0.85 : (biggest <= 6 ? 1.15 : 1);   // 큰 주사위일수록 낮은 소리
      // 알림음을 꺼 둔 사람에게는 굴림 소리도 내지 않는다 (같은 🔔 단추를 따른다).
      const soundOn = MM.Sound?.enabled !== false && (MM.Sound?.volume ?? 1) > 0;
      DICE.sound_url = soundOn ? `${VENDOR}dicesound.mp3` : null;
      box.throw_strength = typeof roll.strength === 'number' ? roll.strength : null;
      box.setDice(v.notation);

      let ended = false;
      const finish = () => {
        if (ended) return;
        ended = true;
        setTimeout(() => { if (!rolling) box.clear(); }, 3000);            // 3초 뒤 치운다
        done();
      };
      // 물리가 어쩌다 멈추지 않아도 결과는 반드시 뜨게 한다.
      const guard = setTimeout(finish, 9000);
      try {
        box.start_throw(() => v.values, () => { clearTimeout(guard); finish(); });
      } catch (e) {
        clearTimeout(guard);
        console.warn('[TRPG] 굴리기 실패 —', e.message);
        finish();
      }
    }

    /** 결과 말풍선. 비밀 굴림은 내 화면에만 남긴다 (서버에 대화 줄이 없다). */
    function showRollMessage(roll) {
      const msg = roll.message || {
        id: `secret-${roll.id}`,
        sender: roll.sender,
        gmId: roll.sender === 'gm' ? roll.actorId : null,
        participantId: roll.sender === 'player' ? roll.actorId : null,
        nickname: roll.nickname,
        color: roll.color || null,
        kind: 'dice',
        body: null,
        secret: !!roll.secret,
        meta: { notation: roll.notation, detail: roll.detail, total: roll.total },
        createdAt: roll.createdAt,
      };
      addMsg(msg);
    }

    // ── 주사위 판 (단추로 담기 + 파워 게이지) ───────────────────────────────
    const trayEl = $('.tg-tray');
    const powerEl = $('.tg-power');
    const stage = {};                                   // { d6: 2, ... }

    const paintStage = () => {
      for (const btn of trayEl.querySelectorAll('.tg-die')) {
        const n = stage[`d${btn.dataset.sides}`] || 0;
        btn.querySelector('.cnt').textContent = n;
        btn.classList.toggle('on', n > 0);
      }
    };
    const bump = (sides, by) => {
      const key = `d${sides}`;
      stage[key] = Math.max(0, Math.min(30, (stage[key] || 0) + by));
      paintStage();
    };

    $('.tg-dicebtn').addEventListener('click', () => {
      trayEl.classList.toggle('hidden');
      if (!trayEl.classList.contains('hidden')) ensureDice();   // 미리 받아 둔다
    });
    trayEl.addEventListener('click', (e) => {
      const die = e.target.closest('.tg-die');
      if (die) return bump(die.dataset.sides, 1);
      if (e.target.closest('.tg-reset')) {
        for (const k of Object.keys(stage)) stage[k] = 0;
        paintStage();
      }
    });
    trayEl.addEventListener('contextmenu', (e) => {
      const die = e.target.closest('.tg-die');
      if (!die) return;
      e.preventDefault();                                        // 오른쪽 단추로 하나 빼기
      bump(die.dataset.sides, -1);
    });

    /** 담은 주사위를 식으로 (2d6 + 1d20) */
    const stageText = () => Object.entries(stage)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${n}${k}`)
      .join('+');

    function doRoll(strength) {
      const text = stageText();
      if (!text) return MM.toast('굴릴 주사위를 먼저 고르세요', true);
      o.onRoll?.({
        notation: text,
        strength,
        secret: !!trayEl.querySelector('.tg-secret input')?.checked,
      });
      for (const k of Object.keys(stage)) stage[k] = 0;           // 담은 것은 비운다
      paintStage();
    }

    // 힘 조절 — 꾹 누르면 원호 게이지의 지시선이 좌우로 오간다.
    // 왼쪽이 약하게, 오른쪽이 세게. 놓은 자리의 10단계가 던지는 힘이 된다.
    const STEPS = 10;
    let gauge = null;
    const rollBtn = $('.tg-roll');

    /**
     * 힘 조절 — **가운데가 가장 세고, 옆으로 갈수록 약하다.**
     * 바늘이 빠르게 오가므로 가운데(밝게 칠한 자리)에서 손을 떼는 것이 관건이다.
     */
    function startGauge() {
      if (gauge) return;
      powerEl.classList.remove('hidden');
      const t0 = performance.now();
      gauge = { step: 1, raf: 0 };
      const needle = powerEl.querySelector('.needle');
      const stepEl = powerEl.querySelector('.step');
      const tick = (now) => {
        const phase = ((now - t0) / 450) % 2;                     // 0→1→0 왕복 (예전의 두 배 속도)
        const pos = phase < 1 ? phase : 2 - phase;                // 0(왼쪽) ~ 1(오른쪽)
        const power = 1 - Math.abs(pos - 0.5) * 2;                // 가운데 1, 양끝 0
        gauge.step = Math.max(1, Math.round(power * STEPS));
        needle.setAttribute('transform', `rotate(${-90 + pos * 180} 60 58)`);
        stepEl.textContent = gauge.step;
        powerEl.classList.toggle('hot', gauge.step >= 9);         // 가장 센 자리에 들어왔다
        gauge.raf = requestAnimationFrame(tick);
      };
      gauge.raf = requestAnimationFrame(tick);
    }
    function endGauge() {
      if (!gauge) return null;
      cancelAnimationFrame(gauge.raf);
      const step = gauge.step;
      gauge = null;
      powerEl.classList.add('hidden');
      powerEl.classList.remove('hot');
      return step;
    }

    let holdTimer = null;
    rollBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      rollBtn.setPointerCapture?.(e.pointerId);
      holdTimer = setTimeout(startGauge, 180);                    // 톡 누르면 게이지 없이 바로
    });
    const release = () => {
      clearTimeout(holdTimer);
      const step = endGauge();
      doRoll(step ? step / STEPS : null);                         // 안 눌렀으면 세기는 맡긴다
    };
    rollBtn.addEventListener('pointerup', release);
    rollBtn.addEventListener('pointercancel', () => { clearTimeout(holdTimer); endGauge(); });
    paintStage();

    // ── 보내기 ──────────────────────────────────────────────────────────────
    // 「/1d20+3」 처럼 빗금 뒤에 식만 적어도 굴린다. 예전 「/roll ...」 도 그대로 받는다.
    const ROLL_CMD = /^\/(?:(?:roll|굴림|주사위)\s+)?(?=[^]*\d)([\d\s+\-*/().dD]+)$/;

    function send() {
      const text = inputEl.value.trim();
      if (!text) return;
      inputEl.value = '';
      MM.autoGrow(inputEl, 100);
      // 「/1d20+3」 은 말이 아니라 주사위다.
      const cmd = ROLL_CMD.exec(text);
      if (cmd) return o.onRoll?.({ notation: cmd[1].trim() });
      o.onSay?.(text);
    }
    $('.tg-send').addEventListener('click', send);
    inputEl.addEventListener('input', () => MM.autoGrow(inputEl, 100));
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
    });

    const fileInput = $('.tg-fileinput');
    $('.tg-file').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const files = [...fileInput.files];
      fileInput.value = '';
      if (files.length) o.onFiles?.(files);
    });
    MM.makeDropzone(root, (files) => o.onFiles?.(files), () => '여기에 놓으면 모두에게 갑니다');
    MM.onPasteFiles(inputEl, (files) => o.onFiles?.(files));

    setBoard(null);
    paintLog();
    paintPin();

    return {
      el: root,
      setBoard,
      setMessages,
      addMsg,
      delMsg,
      clearLog: () => setMessages([]),
      slots,
      artRect,
      onArtChange: (fn) => { artWatchers.push(fn); fn(artRect()); },
      playRoll,
      showSecretTools: (on) => trayEl.querySelector('.tg-secret').classList.toggle('hidden', !on),
      focus: () => inputEl.focus(),
      stageEl,
      stop: () => { audio.pause(); audio.removeAttribute('src'); },
    };
  }

  global.TRPG = { createStage };
})(window);
