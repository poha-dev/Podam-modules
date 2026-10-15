/* 🎲 간이 TRPG — 캐릭터 카드 (무대 아래 가로줄)
   그림 + 수치(HP·MP 같은 것) + 상태이상. 카드를 누르면 옆에 고치는 쪽지가 뜬다.
   누가 무엇을 고칠 수 있는지는 서버가 정한다 — 여기서는 보여 주고 막는 것까지만 한다. */
(function (global) {
  'use strict';

  const esc = (s) => MM.esc(s);

  /**
   * 무대가 빌려준 자리에 카드 줄을 얹는다.
   * @param {object} host  { ctx, stage, slots:{below,layer,stageEl}, isGm, meId, fileUrl }
   */
  function mount(host) {
    const ctx = host.ctx;
    const root = host.slots.below;
    const o = {
      isGm: host.isGm,
      meId: host.meId,
      fileUrl: host.fileUrl,
      participants: () => (ctx.participants ? ctx.participants() : []),
      onChar: (payload) => ctx.socket.emit('mod:trpg-chars:save', payload, (res) => {
        if (res?.error) MM.toast(res.error, true);
      }),
      onImage: async (id, file) => {
        const fd = new FormData();
        fd.append('files', file);
        const headers = ctx.AUTH ? ctx.AUTH() : ctx.headers();
        try {
          await MM.api(`/api/trpg-chars/${id}/image`, { method: 'POST', headers, body: fd });
        } catch (e) { MM.toast(e.message, true); }
      },
    };

    let chars = [];
    let template = [];
    let openId = null;                       // 지금 열어 둔 편집 쪽지
    let dirty = null;                        // 보내기를 기다리는 카드 (모아 보내기)
    let timer = null;

    root.classList.add('tg-chars');
    root.innerHTML = `
      <div class="tg-charlist"></div>
      <div class="tg-charbtns">
        <button class="ghost tg-charadd" title="카드 만들기">＋</button>
        <button class="ghost tg-charall" title="모두 한눈에 보기">📋</button>
      </div>`;

    const listEl = root.querySelector('.tg-charlist');

    // 편집 쪽지는 **화면에 고정**한다. 좁은 칸이나 전체 화면 어디서 열어도
    // 칸 경계에 잘리지 않고, 무대가 통째로 옮겨 다녀도 흔들리지 않는다.
    const editEl = document.createElement('div');
    editEl.className = 'tg-cedit hidden';
    document.body.appendChild(editEl);

    // 무대 위 토큰이 놓이는 층
    const layerEl = host.slots.layer;

    const byId = (id) => chars.find((c) => c.id === id);
    const canEdit = (c) => o.isGm || (c.ownerId && c.ownerId === o.meId);
    const mineCount = () => chars.filter((c) => c.ownerId && c.ownerId === o.meId).length;

    // ── 카드 줄 ─────────────────────────────────────────────────────────────
    function faceHtml(c) {
      if (c.imageFileId) {
        return `<img src="${o.fileUrl(c.imageFileId)}" alt="">`;
      }
      return `<span class="ini">${esc((c.name || '?').trim().slice(0, 2))}</span>`;
    }

    function barsHtml(c, all) {
      const rows = all ? c.stats : c.stats.slice(0, 2);
      return rows.map((s) => {
        const pct = s.max > 0 ? Math.max(0, Math.min(100, (s.cur / s.max) * 100)) : 0;
        const low = s.max > 0 && s.cur <= s.max * 0.3;
        return `<div class="tg-bar${low ? ' low' : ''}">
            <span class="lb">${esc(s.label)}</span>
            <span class="tr"><span class="fill" style="width:${pct}%"></span></span>
            <span class="nm">${s.cur}<span class="faint">/${s.max}</span></span>
          </div>`;
      }).join('');
    }

    const statusHtml = (c) => (c.status.length
      ? `<div class="tg-cstatus">${c.status.map((s) => `<span class="chip">${esc(s)}</span>`).join('')}</div>`
      : '');

    function paintList() {
      listEl.innerHTML = chars.length === 0
        ? '<div class="tg-charnone">아직 캐릭터가 없습니다. ＋ 로 만들어 보세요.</div>'
        : chars.map((c) => `
          <div class="tg-char${c.hidden ? ' hid' : ''}${canEdit(c) ? ' mine' : ''}${openId === c.id ? ' on' : ''}"
               data-id="${c.id}" draggable="${o.isGm}" title="${esc(c.name)}">
            <div class="tg-cface">${faceHtml(c)}</div>
            <div class="tg-cbody">
              <div class="tg-cname">${c.hidden ? '🙈 ' : ''}${esc(c.name)}</div>
              ${barsHtml(c)}
              ${statusHtml(c)}
            </div>
          </div>`).join('');
      root.querySelector('.tg-charadd').classList.toggle(
        'hidden', !o.isGm && mineCount() >= 3);
    }

    // ── 편집 쪽지 ───────────────────────────────────────────────────────────
    function editHtml(c) {
      const ro = !canEdit(c);
      const people = (o.participants?.() || []);
      return `
        <div class="tg-cedit-head">
          <input class="tg-f-name" value="${esc(c.name)}" maxlength="20" placeholder="이름"${ro ? ' disabled' : ''}>
          <button class="ghost tg-cclose" title="닫기">✕</button>
        </div>

        <div class="row" style="align-items:flex-start">
          <div class="tg-cpic${ro ? '' : ' drop'}" title="${ro ? '' : '그림을 끌어다 놓거나 눌러서 고르세요'}">
            ${c.imageFileId ? `<img src="${o.fileUrl(c.imageFileId)}" alt="">` : '<span class="faint">그림</span>'}
          </div>
          <div class="grow">
            <div class="tg-fstats"></div>
            ${ro ? '' : `<div class="row" style="gap:4px;margin-top:4px">
              <button class="ghost tg-addstat">＋ 항목</button>
              <button class="ghost tg-usetpl" title="이 방의 기본 항목을 채워 넣습니다">기본틀</button>
            </div>`}
          </div>
        </div>

        <div class="tg-fstatus"></div>
        ${ro ? '' : '<input class="tg-f-newstatus" placeholder="상태이상 적고 Enter (예: 중독)" maxlength="12">'}

        <label class="tg-onstage">
          <input type="checkbox" class="tg-f-onstage"${c.onStage ? ' checked' : ''}>
          🗺 무대에 올리기 <span class="faint">(끌어서 옮깁니다)</span>
        </label>

        <textarea class="tg-f-note" rows="2" placeholder="메모 (모두가 봅니다)" maxlength="200"${ro ? ' disabled' : ''}>${esc(c.note)}</textarea>

        ${o.isGm ? `
          <div class="row tg-cgm">
            <label class="faint"><input type="checkbox" class="tg-f-hidden"${c.hidden ? ' checked' : ''}> 🙈 숨김</label>
            <select class="tg-f-owner grow" title="이 카드의 주인">
              <option value="">GM (NPC)</option>
              ${people.map((p) => `<option value="${p.id}"${c.ownerId === p.id ? ' selected' : ''}>${esc(p.nickname)}</option>`).join('')}
            </select>
            <button class="danger tg-cdel">삭제</button>
          </div>`
        : (canEdit(c) ? '<div class="row"><button class="danger tg-cdel">삭제</button></div>' : '')}

        ${ro ? '<div class="faint">다른 사람의 카드라 볼 수만 있습니다.</div>' : ''}`;
    }

    function paintStats(c) {
      const ro = !canEdit(c);
      editEl.querySelector('.tg-fstats').innerHTML = c.stats.map((s, i) => `
        <div class="tg-fstat" data-i="${i}">
          <input class="lb" value="${esc(s.label)}" maxlength="12"${ro ? ' disabled' : ''}>
          ${ro ? '' : '<button class="ghost minus" title="-1">−</button>'}
          <input class="cur" type="number" value="${s.cur}"${ro ? ' disabled' : ''}>
          ${ro ? '' : '<button class="ghost plus" title="+1">＋</button>'}
          <span class="faint">/</span>
          <input class="max" type="number" value="${s.max}"${ro ? ' disabled' : ''}>
          ${ro ? '' : '<button class="ghost del" title="이 항목 빼기">✕</button>'}
        </div>`).join('');
      editEl.querySelector('.tg-fstatus').innerHTML = c.status.map((s, i) => `
        <span class="chip">${esc(s)}${ro ? '' : `<button class="x" data-i="${i}" title="빼기">✕</button>`}</span>`).join('');
    }

    function openEdit(id) {
      const c = byId(id);
      if (!c) return closeEdit();
      openId = id;
      editEl.innerHTML = editHtml(c);
      paintStats(c);
      editEl.classList.remove('hidden');

      placeEdit(listEl.querySelector(`.tg-char[data-id="${id}"]`)
        || layerEl.querySelector(`.tg-token[data-id="${id}"]`));
      if (canEdit(c)) {
        const pic = editEl.querySelector('.tg-cpic');
        MM.makeDropzone(pic, (files) => o.onImage?.(id, files[0]), () => '그림으로 씁니다');
      }
      paintList();
    }

    /** 누른 것 바로 옆에 붙이되, 화면 밖으로 나가지 않게 가둔다. */
    function placeEdit(anchor) {
      if (!anchor) return;
      const a = anchor.getBoundingClientRect();
      const w = editEl.offsetWidth || 300;
      const h = editEl.offsetHeight || 320;
      const left = Math.max(8, Math.min(a.left, window.innerWidth - w - 8));
      // 기본은 위에 붙이고, 위가 좁으면 아래로 내린다.
      const top = a.top - h - 8 >= 8 ? a.top - h - 8 : Math.min(a.bottom + 8, window.innerHeight - h - 8);
      editEl.style.left = `${Math.round(left)}px`;
      editEl.style.top = `${Math.round(Math.max(8, top))}px`;
    }

    function closeEdit() {
      openId = null;
      editEl.classList.add('hidden');
      editEl.innerHTML = '';
      paintList();
    }

    /** 고친 내용을 모아서 보낸다 (한 글자마다 보내지 않게). */
    function queue(id) {
      const c = byId(id);
      if (!c) return;
      dirty = { id, name: c.name, stats: c.stats, status: c.status, note: c.note, hidden: c.hidden, ownerId: c.ownerId };
      clearTimeout(timer);
      timer = setTimeout(flush, 350);
    }
    function flush() {
      clearTimeout(timer);
      if (!dirty) return;
      const payload = dirty;
      dirty = null;
      o.onChar?.({ op: 'save', char: payload });
    }

    // ── 조작 ────────────────────────────────────────────────────────────────
    listEl.addEventListener('click', (e) => {
      const card = e.target.closest('.tg-char');
      if (!card) return;
      if (openId === card.dataset.id) closeEdit();
      else openEdit(card.dataset.id);
    });

    root.querySelector('.tg-charadd').addEventListener('click', () => {
      flush();
      o.onChar?.({
        op: 'save',
        char: { name: o.isGm ? '새 카드' : '내 캐릭터', stats: template, status: [], note: '' },
      });
    });

    root.querySelector('.tg-charall').addEventListener('click', openOverview);

    // GM은 끌어서 순서를 바꾼다
    MM.makeSortable(listEl, '.tg-char', (ids) => { if (o.isGm) o.onChar?.({ op: 'order', ids }); });

    editEl.addEventListener('click', (e) => {
      const c = byId(openId);
      if (!c) return;
      if (e.target.closest('.tg-cclose')) return closeEdit();

      if (e.target.closest('.tg-cdel')) {
        if (!confirm(`「${c.name}」 카드를 지울까요?`)) return;
        o.onChar?.({ op: 'del', id: c.id });
        return closeEdit();
      }
      if (e.target.closest('.tg-cpic') && canEdit(c)) {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = 'image/*';
        inp.addEventListener('change', () => { if (inp.files[0]) o.onImage?.(c.id, inp.files[0]); });
        inp.click();
        return;
      }
      if (e.target.closest('.tg-addstat')) {
        c.stats = [...c.stats, { label: '항목', cur: 0, max: 0 }];
        paintStats(c); queue(c.id); return;
      }
      if (e.target.closest('.tg-usetpl')) {
        // 이 방의 기본 항목 중 **빠진 것만** 채워 넣는다.
        const have = new Set(c.stats.map((x) => x.label));
        const add = template.filter((t) => !have.has(t.label));
        if (!template.length) return MM.toast('GM이 정해 둔 기본 항목이 없습니다', true);
        if (!add.length) return MM.toast('기본 항목이 이미 다 들어 있습니다');
        c.stats = [...c.stats, ...add.map((t) => ({ ...t }))];
        paintStats(c); queue(c.id);
        MM.toast(`${add.map((t) => t.label).join(' · ')} 을(를) 채웠습니다`);
        return;
      }

      const row = e.target.closest('.tg-fstat');
      if (row) {
        const i = Number(row.dataset.i);
        if (e.target.closest('.del')) { c.stats.splice(i, 1); paintStats(c); queue(c.id); return; }
        if (e.target.closest('.minus') || e.target.closest('.plus')) {
          c.stats[i].cur += e.target.closest('.plus') ? 1 : -1;
          paintStats(c); queue(c.id); return;
        }
      }
      const x = e.target.closest('.tg-fstatus .x');
      if (x) {
        c.status.splice(Number(x.dataset.i), 1);
        paintStats(c); queue(c.id);
      }
    });

    editEl.addEventListener('input', (e) => {
      const c = byId(openId);
      if (!c || !canEdit(c)) return;
      if (e.target.classList.contains('tg-f-name')) c.name = e.target.value;
      else if (e.target.classList.contains('tg-f-note')) c.note = e.target.value;
      else {
        const row = e.target.closest('.tg-fstat');
        if (!row) return;
        const s = c.stats[Number(row.dataset.i)];
        if (!s) return;
        if (e.target.classList.contains('lb')) s.label = e.target.value;
        if (e.target.classList.contains('cur')) s.cur = Number(e.target.value) || 0;
        if (e.target.classList.contains('max')) s.max = Number(e.target.value) || 0;
      }
      queue(c.id);
    });

    editEl.addEventListener('change', (e) => {
      const c = byId(openId);
      if (!c) return;
      if (e.target.classList.contains('tg-f-onstage')) {
        c.onStage = e.target.checked;
        paintTokens();
        ctx.socket.emit('mod:trpg-chars:place', { id: c.id, on: c.onStage }, (res) => {
          if (res?.error) MM.toast(res.error, true);
        });
      }
      if (e.target.classList.contains('tg-f-hidden')) { c.hidden = e.target.checked; queue(c.id); }
      if (e.target.classList.contains('tg-f-owner')) { c.ownerId = e.target.value || null; queue(c.id); }
    });

    editEl.addEventListener('keydown', (e) => {
      const c = byId(openId);
      if (!c) return;
      if (e.key === 'Escape') return closeEdit();
      if (e.key === 'Enter' && e.target.classList.contains('tg-f-newstatus') && !e.isComposing) {
        e.preventDefault();
        const v = e.target.value.trim();
        if (!v) return;
        c.status = [...c.status, v];
        e.target.value = '';
        paintStats(c);
        queue(c.id);
      }
    });

    // ── 모두 한눈에 ─────────────────────────────────────────────────────────
    function openOverview() {
      const back = document.createElement('div');
      back.className = 'mdl-back';
      back.innerHTML = `
        <div class="mdl" style="max-width:720px">
          <h3>📋 캐릭터</h3>
          <div class="tg-allgrid">
            ${chars.length === 0 ? '<div class="empty">아직 캐릭터가 없습니다.</div>'
              : chars.map((c) => `
                <div class="tg-allcard${c.hidden ? ' hid' : ''}">
                  <div class="row" style="gap:8px;align-items:flex-start">
                    <div class="tg-cface">${faceHtml(c)}</div>
                    <div class="grow">
                      <div class="tg-cname">${c.hidden ? '🙈 ' : ''}${esc(c.name)}</div>
                      ${barsHtml(c, true)}
                      ${statusHtml(c)}
                      ${c.note ? `<div class="faint" style="margin-top:4px">${esc(c.note)}</div>` : ''}
                    </div>
                  </div>
                </div>`).join('')}
          </div>
          <div class="row" style="justify-content:flex-end;margin-top:12px">
            <button class="ghost" data-close>닫기</button>
          </div>
        </div>`;
      const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
      const onKey = (ev) => { if (ev.key === 'Escape') close(); };
      back.addEventListener('click', (ev) => {
        if (ev.target === back || ev.target.closest('[data-close]')) close();
      });
      document.addEventListener('keydown', onKey);
      document.body.appendChild(back);
    }

    // ── GM 조작판에 얹는 「기본 항목」 ──────────────────────────────────────
    // 새로 만드는 카드가 물려받을 항목을 방마다 정해 둔다.
    let tplRows = [];
    if (host.slots.ctl) {
      const ctl = host.slots.ctl;
      ctl.innerHTML = `
        <div class="tg-head">캐릭터 <button class="ghost tg-tplbtn">기본 항목</button></div>
        <div class="tg-tpl hidden">
          <div class="faint" style="margin-bottom:4px">
            새로 만드는 카드가 이 항목들을 그대로 물려받습니다.
          </div>
          <div class="tg-tplrows"></div>
          <div class="row" style="gap:4px;margin-top:4px">
            <button class="ghost tg-tpladd">＋ 항목</button>
            <button class="primary grow tg-tplsave">저장</button>
          </div>
        </div>`;

      /**
       * 칸에 친 것을 먼저 거둬들인다.
       * 이걸 안 하면 「＋ 항목」 으로 다시 그리는 순간 방금 고친 이름과 숫자가 날아간다.
       */
      const syncTpl = () => {
        const rows = [...ctl.querySelectorAll('.tg-tplrows .tg-fstat')];
        if (!rows.length) return;
        tplRows = rows.map((el) => {
          const max = Number(el.querySelector('.max').value) || 0;
          return { label: el.querySelector('.lb').value, cur: max, max };
        });
      };

      const paintTpl = () => {
        ctl.querySelector('.tg-tplrows').innerHTML = tplRows.map((r, i) => `
          <div class="tg-fstat" data-i="${i}">
            <input class="lb" value="${esc(r.label)}" maxlength="12" placeholder="항목">
            <input class="max" type="number" value="${r.max}" title="최대값">
            <button class="ghost del" title="빼기">✕</button>
          </div>`).join('') || '<div class="faint">항목이 없습니다.</div>';
      };

      ctl.addEventListener('click', (e) => {
        if (e.target.closest('.tg-tplbtn')) {
          const open = ctl.querySelector('.tg-tpl').classList.toggle('hidden') === false;
          if (open) { tplRows = template.map((r) => ({ ...r })); paintTpl(); }
          return;
        }
        if (e.target.closest('.tg-tpladd')) {
          syncTpl();
          tplRows = [...tplRows, { label: '', cur: 10, max: 10 }];
          return paintTpl();
        }
        const del = e.target.closest('.del');
        if (del) {
          syncTpl();
          tplRows.splice(Number(del.closest('.tg-fstat').dataset.i), 1);
          return paintTpl();
        }
        if (e.target.closest('.tg-tplsave')) {
          // 최대값을 그대로 현재값으로 삼는다 (새 카드는 가득 찬 상태로 시작한다).
          syncTpl();
          const rows = tplRows.filter((r) => r.label.trim());
          ctx.socket.emit('mod:trpg-chars:tpl', { rows }, (res) => {
            if (res?.error) return MM.toast(res.error, true);
            template = res.statTemplate;
            tplRows = template.map((r) => ({ ...r }));
            paintTpl();
            MM.toast('기본 항목을 저장했습니다');
          });
        }
      });
    }

    // ── 무대 위 토큰 ────────────────────────────────────────────────────────
    // 자리는 **배경 그림 안에서의 비율**로 주고받는다. 화면 크기가 서로 달라도
    // 모두가 그림의 같은 지점을 가리키게 하려는 것이다.
    // 자리는 **그릴 때마다 다시 잰다.** 무대가 숨겨져 있을 때 한 번 재 두면
    // (탭을 바꾸기 전) 크기가 0이라 토큰이 구석에 몰린다.
    let art = { left: 0, top: 0, w: 0, h: 0 };
    const measure = () => {
      const r = host.stage?.artRect?.();
      if (r && r.w > 0 && r.h > 0) art = r;
      return art;
    };
    host.stage?.onArtChange?.(() => { measure(); placeTokens(); });
    window.addEventListener('resize', () => { measure(); placeTokens(); });
    // 탭을 눌러 무대가 보이기 시작하는 순간에도 다시 잰다.
    for (const bar of ['ptabs', 'rtabs']) {
      document.getElementById(bar)?.addEventListener('click', () => {
        setTimeout(() => { measure(); placeTokens(); }, 60);
      });
    }

    const onStage = () => chars.filter((c) => c.onStage);

    function paintTokens() {
      const want = onStage();
      layerEl.innerHTML = want.map((c) => `
        <div class="tg-token${c.hidden ? ' hid' : ''}" data-id="${c.id}" title="${esc(c.name)}">
          <div class="tg-tface">${faceHtml(c)}</div>
          <div class="tg-tname">${esc(c.name)}</div>
        </div>`).join('');
      placeTokens();
    }

    /** 비율 → 화면 자리. 배경이 바뀌거나 창이 커져도 이 함수만 다시 부르면 된다. */
    function placeTokens() {
      measure();
      for (const el of layerEl.querySelectorAll('.tg-token')) {
        const c = byId(el.dataset.id);
        if (!c) continue;
        el.style.left = `${art.left + art.w * c.x}px`;
        el.style.top = `${art.top + art.h * c.y}px`;
      }
    }

    // 끌어서 옮기기 — 방에 있는 사람이면 누구나 옮길 수 있다.
    let drag = null;
    let sendAt = 0;
    const sendPlace = (c, force) => {
      const now = performance.now();
      if (!force && now - sendAt < 120) return;          // 끄는 동안은 조금씩만 알린다
      sendAt = now;
      ctx.socket.emit('mod:trpg-chars:place', { id: c.id, x: c.x, y: c.y }, (res) => {
        if (res?.error) MM.toast(res.error, true);
      });
    };

    layerEl.addEventListener('pointerdown', (e) => {
      const el = e.target.closest('.tg-token');
      if (!el) return;
      const c = byId(el.dataset.id);
      if (!c || !art.w) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      el.classList.add('moving');
      drag = { el, c };
    });
    layerEl.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const box = layerEl.getBoundingClientRect();
      drag.c.x = Math.min(1, Math.max(0, (e.clientX - box.left - art.left) / art.w));
      drag.c.y = Math.min(1, Math.max(0, (e.clientY - box.top - art.top) / art.h));
      placeTokens();
      sendPlace(drag.c);
    });
    const dropToken = () => {
      if (!drag) return;
      drag.el.classList.remove('moving');
      sendPlace(drag.c, true);                            // 놓는 순간에는 반드시 알린다
      drag = null;
    };
    layerEl.addEventListener('pointerup', dropToken);
    layerEl.addEventListener('pointercancel', dropToken);

    // 마우스를 올리면 수치와 상태이상을 보여 준다.
    const tipEl = document.createElement('div');
    tipEl.className = 'tg-tip hidden';
    document.body.appendChild(tipEl);
    layerEl.addEventListener('pointerover', (e) => {
      const el = e.target.closest('.tg-token');
      if (!el || drag) return;
      const c = byId(el.dataset.id);
      if (!c) return;
      tipEl.innerHTML = `<div class="tg-cname">${c.hidden ? '🙈 ' : ''}${esc(c.name)}</div>`
        + barsHtml(c, true)
        + statusHtml(c)
        + (c.note ? `<div class="faint" style="margin-top:4px">${esc(c.note)}</div>` : '');
      tipEl.classList.remove('hidden');
      const a = el.getBoundingClientRect();
      const w = tipEl.offsetWidth;
      tipEl.style.left = `${Math.max(8, Math.min(a.left, window.innerWidth - w - 8))}px`;
      tipEl.style.top = `${Math.max(8, a.top - tipEl.offsetHeight - 8)}px`;
    });
    layerEl.addEventListener('pointerout', (e) => {
      if (!e.relatedTarget?.closest?.('.tg-token')) tipEl.classList.add('hidden');
    });

    // 토큰을 두 번 누르면 그 카드를 연다.
    layerEl.addEventListener('dblclick', (e) => {
      const el = e.target.closest('.tg-token');
      if (el) openEdit(el.dataset.id);
    });

    // ── 서버와 주고받기 ─────────────────────────────────────────────────────
    function setChars(list) {
      // 고치는 중인 카드는 내가 친 내용을 지키기 위해 그대로 둔다.
      const keep = dirty ? byId(dirty.id) : null;
      chars = (list || []).map((c) => (keep && c.id === keep.id ? keep : c));
      if (openId && !byId(openId)) closeEdit();
      else paintList();
      paintTokens();
      setTimeout(placeTokens, 400);        // 배경 그림이 늦게 뜨는 경우 대비
    }

    const hello = () => ctx.socket.emit('mod:trpg-chars:hello', {}, (res) => {
      if (!res || res.error) return;
      template = res.statTemplate || [];
      setChars(res.chars);
    });
    hello();
    ctx.socket.on('connect', hello);
    ctx.socket.on('chars:list', ({ chars: list }) => setChars(list));
    ctx.socket.on('chars:move', ({ id, x, y, onStage: on }) => {
      const c = byId(id);
      if (!c) return;
      if (drag && drag.c.id === id) return;              // 내가 끄는 중이면 내 손이 우선
      c.x = x; c.y = y; c.onStage = on;
      paintTokens();
    });
    ctx.socket.on('chars:tpl', ({ statTemplate }) => { template = statTemplate || []; });

    return { setChars, setTemplate: (rows) => { template = rows || []; }, close: closeEdit, flush };
  }

  global.TRPGChars = { mount };
})(window);
