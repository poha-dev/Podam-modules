/* 🤖 AI 시나리오 보조 — GM 화면.

   API 키는 **이 브라우저에만** 있고(localStorage), 모델도 여기서 직접 부른다.
   서버는 원본과 읽어 낸 조각만 들고 있다가 질문에 맞는 대목을 골라 준다. */
(function () {
  'use strict';

  const KEY = 'mm.ai';                   // 키·모델 (방과 무관, 이 브라우저 전용)
  const PROVIDERS = [
    { id: 'openai', name: 'OpenAI', model: 'gpt-5' },
    { id: 'gemini', name: 'Gemini', model: 'gemini-2.5-pro' },
  ];
  // 질문칸을 채워 주는 틀. 늘리고 싶으면 이 배열에 한 줄 더한다.
  const CHIPS = [
    ['등장인물', '이 작품에 나오는 인물을 모두 적고, 각자 어떤 사람인지 자료에 적힌 대로만 알려줘.'],
    ['시간표', '사건 당일의 시간 순서를 자료에 적힌 대로 정리해줘.'],
    ['단서', '플레이어가 얻을 수 있는 단서와 그 단서가 어디서 나오는지 정리해줘.'],
    ['알리바이', '〈이름〉의 알리바이가 어떻게 적혀 있어?'],
    ['이럴 땐?', '플레이어가 〈무엇〉을(를) 물어보면 뭐라고 답해야 해?'],
  ];

  function loadLlm() {
    if (window.AILLM) return Promise.resolve();
    if (!loadLlm.p) {
      loadLlm.p = new Promise((resolve, reject) => {
        const el = document.createElement('script');
        el.src = '/modules/ai.llm.js';
        el.onload = resolve;
        el.onerror = () => reject(new Error('AI 화면을 불러오지 못했습니다'));
        document.head.appendChild(el);
      });
    }
    return loadLlm.p;
  }

  MM.Panels.define({
    id: 'ai',
    side: 'gm',
    label: '🤖 AI 보조',
    mount(root, ctx) {
      const esc = MM.esc;
      const $ = (sel) => root.querySelector(sel);

      let cfg = { provider: 'openai', key: '', model: PROVIDERS[0].model, mode: 'open' };
      try { cfg = { ...cfg, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { /* 처음 */ }
      const saveCfg = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* 사생활 보호 모드 */ } };

      let works = [];
      let workId = null;
      let docs = [];
      let asks = [];
      let out = null;                    // 지금 보여 주는 답 또는 찾은 결과
      let busy = false;                  // 읽는 중
      let stop = false;                  // 멈춰 달라고 눌렀다
      let keyOpen = !cfg.key;

      /** 소켓 한 번 물어보기. */
      const call = (ev, payload) => new Promise((resolve) => {
        const sock = ctx.socket;
        if (!sock) return resolve({ error: '연결이 끊어졌습니다' });
        sock.emit(ev, payload, (res) => resolve(res || {}));
      });

      root.innerHTML = `
        <div class="ai">
          <div class="ai-key"></div>
          <div class="ai-work"></div>
          <div class="ai-docs"></div>
          <div class="ai-ask"></div>
          <div class="ai-out"></div>
          <div class="ai-log"></div>
        </div>`;

      // ── 설정 (키) ──────────────────────────────────────────────────────────
      function tail(k) {
        const s = String(k || '');
        return s.length > 8 ? `${s.slice(0, 3)}…${s.slice(-4)}` : (s ? '••••' : '');
      }

      function paintKey() {
        const p = PROVIDERS.find((x) => x.id === cfg.provider) || PROVIDERS[0];
        $('.ai-key').innerHTML = keyOpen ? `
          <div class="ai-head">🔑 내 API 키
            <select class="ai-prov">${PROVIDERS.map((x) =>
              `<option value="${x.id}"${x.id === cfg.provider ? ' selected' : ''}>${x.name}</option>`).join('')}</select>
            <span class="grow"></span>
            <button class="ghost tiny ai-keyclose">접기</button></div>
          <div class="ai-row">
            <input type="password" class="ai-keyin grow" placeholder="API 키" value="${esc(cfg.key)}" autocomplete="off">
          </div>
          <div class="ai-row">
            <input class="ai-model grow" placeholder="모델" value="${esc(cfg.model || p.model)}" list="ai-models">
            <datalist id="ai-models"></datalist>
            <button class="ghost ai-test">시험</button>
          </div>
          <p class="faint tiny">키는 <b>이 브라우저에만</b> 저장됩니다. 자료 내용은 ${esc(p.name)} 로 전송됩니다.</p>
        ` : `
          <div class="ai-head">🔑 ${esc(p.name)} · ${esc(cfg.model)} <span class="faint">${esc(tail(cfg.key))}</span>
            <button class="ghost tiny ai-keyopen">바꾸기</button></div>`;
      }

      // ── 작품 ───────────────────────────────────────────────────────────────
      function paintWork() {
        const w = works.find((x) => x.id === workId);
        $('.ai-work').innerHTML = `
          <div class="ai-row">
            <select class="ai-worksel grow">
              ${works.length ? works.map((x) =>
                `<option value="${x.id}"${x.id === workId ? ' selected' : ''}>${esc(x.name)} (${x.docs}건)</option>`).join('')
                : '<option value="">작품이 없습니다</option>'}
            </select>
            <button class="ghost ai-add" title="새 작품">＋</button>
            <button class="ghost ai-ren" title="이름 바꾸기"${w ? '' : ' disabled'}>✏</button>
            <button class="ghost ai-del" title="작품 지우기"${w ? '' : ' disabled'}>🗑</button>
          </div>
          <div class="ai-row">
            <button class="ghost tiny ai-export"${w ? '' : ' disabled'}>⬇ 내보내기</button>
            <button class="ghost tiny ai-import">⬆ 불러오기</button>
            <input type="file" class="hidden ai-importin" accept=".json,application/json">
            <span class="faint tiny grow">${w ? `${w.chunks}조각` : ''}</span>
          </div>`;
      }

      // ── 자료 ───────────────────────────────────────────────────────────────
      const STATUS = {
        wait: ['아직', ''], busy: ['읽는 중', 'on'], done: ['읽음', 'ok'], fail: ['실패', 'bad'],
      };

      function paintDocs() {
        const waiting = docs.filter((d) => d.status === 'wait' || d.status === 'fail').length;
        $('.ai-docs').innerHTML = `
          <div class="ai-head">📚 자료 ${docs.length ? `<span class="faint">${docs.length}건</span>` : ''}
            <span class="grow"></span>
            ${busy
              ? '<button class="ghost tiny ai-stop">멈춤</button>'
              : `<button class="primary tiny ai-run"${waiting && workId ? '' : ' disabled'}>읽기 시작${waiting ? ` (${waiting})` : ''}</button>`}
          </div>
          <div class="ai-drop">
            <div class="ai-list">
              ${docs.length ? docs.map((d) => {
                const [base, cls] = STATUS[d.status] || STATUS.wait;
                const label = d.status === 'busy' && d.page
                  ? `${base} · ${d.page}${d.total ? `/${d.total}` : ''}쪽` : base;
                return `<div class="ai-doc" data-id="${d.id}">
                  <span class="ico">${MM.iconFor(d.mime)}</span>
                  <span class="nm">${esc(d.name)}${d.path && d.path !== d.name
                    ? `<span class="faint tiny"> ${esc(d.path.replace(/\/[^/]*$/, ''))}</span>` : ''}</span>
                  <span class="st ${cls}">${label}${d.chars ? ` · ${d.chars.toLocaleString()}자` : ''}</span>
                  <button class="ghost tiny ai-docdel" title="빼기">✕</button>
                  ${d.status === 'fail' && d.error ? `<div class="why">${esc(d.error)}</div>` : ''}
                </div>`;
              }).join('') : '<p class="faint tiny">폴더를 통째로 끌어다 놓으세요 (PDF · 그림 · 글).</p>'}
            </div>
          </div>`;
      }

      // ── 물어보기 ───────────────────────────────────────────────────────────
      function paintAsk() {
        $('.ai-ask').innerHTML = `
          <div class="ai-chips">${CHIPS.map((c, i) =>
            `<button class="ghost tiny ai-chip" data-i="${i}">${esc(c[0])}</button>`).join('')}</div>
          <textarea class="ai-q" rows="2" placeholder="자료에 대해 물어보세요"></textarea>
          <div class="ai-row">
            <button class="primary ai-send grow">물어보기</button>
            <button class="ghost ai-find" title="모델 없이 원문에서 글자로 찾기">🔎 찾기</button>
          </div>
          <div class="ai-modes">
            <button class="ghost tiny ai-mode${cfg.mode === 'open' ? ' on' : ''}" data-mode="open"
              title="자료로 답하고, 모자란 데는 AI가 판단해 보탭니다 (칸을 나눠 보여 줍니다)">🧠 추론까지</button>
            <button class="ghost tiny ai-mode${cfg.mode === 'open' ? '' : ' on'}" data-mode="strict"
              title="자료에 적힌 것만 답합니다. 없으면 없다고 합니다">📖 자료 그대로</button>
          </div>`;
      }

      /** 근거 한 줄 — 누르면 원문이 펼쳐진다. 답과 찾기가 같은 모양을 쓴다. */
      function citeHtml(c, i) {
        const where = [c.docName, c.page ? `${c.page}쪽` : ''].filter(Boolean).join(' · ');
        return `<div class="ai-cite${c.ok === false ? ' bad' : ''}">
          <button class="ai-citehead">[${i + 1}] ${esc(where || '자료')}
            ${c.ok === false ? '<span class="warn">⚠ 원문 확인 실패</span>' : ''}</button>
          ${c.quote ? `<div class="q">“${esc(c.quote)}”</div>` : ''}
          <div class="src hidden">${esc(c.text)}</div>
        </div>`;
      }

      function paintOut() {
        const el = $('.ai-out');
        if (!out) return (el.innerHTML = '');
        if (out.kind === 'busy') return (el.innerHTML = '<p class="faint">자료를 뒤지는 중…</p>');
        if (out.kind === 'error') return (el.innerHTML = `<p class="ai-bad">${esc(out.message)}</p>`);

        // 🔎 찾기 — 모델을 거치지 않고 원문 대목만 보여 준다.
        if (out.kind === 'find') {
          el.innerHTML = `<div class="ai-answer"><div class="ai-qline">🔎 ${esc(out.q)}</div>
            ${out.hits.length
              ? out.hits.map((h, i) => citeHtml({ ...h, quote: '', ok: undefined }, i)).join('')
              : '<p class="none">자료에 없습니다.</p>'}</div>`;
          return;
        }

        // 물어보기 — **자료에 적힌 것**과 **AI의 판단**을 갈라서 그린다.
        const para = (t) => esc(t).replace(/\n/g, '<br>');
        el.innerHTML = `<div class="ai-answer">
          <div class="ai-qline">${esc(out.q)}</div>
          ${out.bad ? '<p class="ai-bad">⚠ 근거가 원문과 맞지 않습니다. 이 답은 믿지 마세요.</p>' : ''}
          ${out.found
            ? `<div class="ai-said"><span class="tag src">📖 자료</span>
                 <div class="ai-text">${para(out.answer)}</div></div>`
            : `<p class="none">${out.guess ? '자료에는 적혀 있지 않습니다.' : '자료에 없습니다.'}</p>`}
          ${out.cites.map(citeHtml).join('')}
          ${out.guess ? `<div class="ai-said guess"><span class="tag">🧠 AI 판단</span>
              <div class="ai-text">${para(out.guess)}</div>
              <p class="faint tiny">${out.beyond
                ? '⚠ 자료 밖 지식이 섞였습니다 — 이 작품의 설정과 다를 수 있습니다.'
                : (out.guessFrom || []).length
                  ? `위 ${out.guessFrom.map((n) => `[${n}]`).join(' ')} 대목에서 끌어냈습니다.`
                  : '자료에 쓰인 말이 아닙니다.'}</p>
            </div>` : ''}
          <p class="faint tiny">${esc(out.model || '')} · 근거를 눌러 원문을 확인하세요.</p>
        </div>`;
      }

      function paintLog() {
        $('.ai-log').innerHTML = asks.length ? `
          <details class="ai-hist">
            <summary>🕘 지난 문답 ${asks.length}</summary>
            ${asks.slice().reverse().map((a) => `
              <div class="ai-histrow" data-id="${a.id}">
                <b>${esc(a.question)}</b>
                <div class="faint tiny">${MM.timeOf(a.createdAt)} · ${esc(a.nickname || '')}
                  ${a.ok ? '' : ' · ⚠'}</div>
              </div>`).join('')}
          </details>` : '';
      }

      const paintAll = () => { paintKey(); paintWork(); paintDocs(); paintAsk(); paintOut(); paintLog(); };

      // ── 서버에서 한 벌 받기 ────────────────────────────────────────────────
      async function load(pick) {
        const res = await call('mod:ai:hello', { workId: pick || workId });
        if (res.error) return MM.toast(res.error, true);
        works = res.works || [];
        workId = res.workId || null;
        docs = res.docs || [];
        asks = res.asks || [];
        paintAll();
      }

      async function refreshDocs() {
        const res = await call('mod:ai:hello', { workId });
        if (res.error) return;
        works = res.works || works;
        docs = res.docs || [];
        asks = res.asks || asks;
        paintWork(); paintDocs(); paintLog();
      }

      // ── 올리기 ─────────────────────────────────────────────────────────────
      async function upload(picked) {
        if (!workId) return MM.toast('먼저 작품을 만들어 주세요', true);
        const items = picked.filter((x) => x.file && x.file.size > 0);
        if (!items.length) return MM.toast('넣을 파일이 없습니다', true);

        let done = 0, failed = 0;
        for (let i = 0; i < items.length; i += 10) {
          const batch = items.slice(i, i + 10);
          const form = new FormData();
          // 경로를 **먼저** 담는다 — 서버가 파일보다 앞서 읽을 수 있게.
          form.append('paths', JSON.stringify(batch.map((b) => b.path || b.file.name)));
          batch.forEach((b) => form.append('files', b.file, b.file.name));
          try {
            const res = await MM.api(`/api/gm/ai/work/${workId}/upload`, {
              method: 'POST', body: form, headers: ctx.AUTH(),
            });
            done += (res.docs || []).length;
          } catch (e) {
            failed += batch.length;
            MM.toast(e.message, true);
          }
        }
        await refreshDocs();
        MM.toast(`${done}건을 넣었습니다${failed ? ` (${failed}건 실패)` : ''}`);
      }

      // ── 읽히기 ─────────────────────────────────────────────────────────────
      async function run() {
        if (busy) return;
        // 키를 여기서 막지 않는다 — 글 파일(txt·md·csv)은 모델 없이도 읽힌다.
        // 모델이 필요한 파일에서만 「키를 먼저 넣어 주세요」가 뜬다.
        await loadLlm();

        busy = true; stop = false; paintDocs();
        let ok = 0, bad = 0;
        try {
          for (const d of docs.filter((x) => x.status === 'wait' || x.status === 'fail')) {
            if (stop) break;
            if (!d.fileId) {
              await call('mod:ai:doc', { op: 'status', id: d.id, status: 'fail', error: '원본 파일이 없습니다' });
              bad++; continue;
            }
            await call('mod:ai:doc', { op: 'status', id: d.id, status: 'busy' });
            d.status = 'busy'; paintDocs();
            try {
              const res = await fetch(`/f/${d.fileId}?gm=${encodeURIComponent(ctx.token())}`);
              if (!res.ok) throw new Error('원본을 받지 못했습니다');
              const blob = await res.blob();
              // 긴 PDF는 몇 쪽씩 나눠 읽는다. 어디까지 왔는지 줄에 보여 준다.
              const pages = await AILLM.readDoc(cfg, { blob, name: d.name, mime: d.mime },
                (page, total) => { d.page = page; d.total = total; paintDocs(); });
              const put = await call('mod:ai:ingest', { docId: d.id, pages });
              if (put.error) throw new Error(put.error);
              ok++;
            } catch (e) {
              // 일부만 읽힌 경우에는 **읽은 데까지는 담고** 까닭을 남긴다.
              if (e.pages?.length) await call('mod:ai:ingest', { docId: d.id, pages: e.pages });
              await call('mod:ai:doc', { op: 'status', id: d.id, status: 'fail', error: e.message });
              bad++;
            }
            delete d.page; delete d.total;
            await refreshDocs();
          }
        } finally {
          busy = false;
          // 멈췄다면 「읽는 중」으로 남은 것을 되돌려 다시 이을 수 있게 한다.
          for (const d of docs.filter((x) => x.status === 'busy')) {
            await call('mod:ai:doc', { op: 'status', id: d.id, status: 'wait' });
          }
          await refreshDocs();
        }
        MM.toast(stop ? `멈췄습니다 (${ok}건 읽음)` : `${ok}건을 읽었습니다${bad ? ` · ${bad}건 실패` : ''}`, !!bad);
      }

      // ── 묻기 · 찾기 ────────────────────────────────────────────────────────
      async function find(q) {
        const res = await call('mod:ai:search', { workId, q });
        if (res.error) { out = { kind: 'error', message: res.error }; return paintOut(); }
        out = { kind: 'find', q, hits: res.hits || [] };
        paintOut();
      }

      async function send(q) {
        if (!cfg.key) { keyOpen = true; paintKey(); return MM.toast('API 키를 먼저 넣어 주세요', true); }
        await loadLlm();
        out = { kind: 'busy' }; paintOut();

        const got = await call('mod:ai:search', { workId, q });
        if (got.error) { out = { kind: 'error', message: got.error }; return paintOut(); }
        const hits = got.hits || [];
        if (!hits.length && cfg.mode !== 'open') {
          out = { kind: 'ask', q, found: false, answer: '', cites: [], guess: '', bad: false, model: cfg.model };
          paintOut();
          await call('mod:ai:log', { workId, question: q, answer: '', cites: [], model: cfg.model, ok: true });
          return refreshDocs();
        }

        try {
          const res = await AILLM.ask(cfg, q, hits, cfg.mode);
          out = { kind: 'ask', q, model: cfg.model, ...res };
          paintOut();
          await call('mod:ai:log', {
            workId, question: q,
            // 기록에도 자료와 판단을 갈라서 남긴다 — 나중에 봐도 헷갈리지 않게.
            answer: [res.found ? res.answer : '', res.guess ? `🧠 AI 판단: ${res.guess}` : '']
              .filter(Boolean).join('\n\n'),
            cites: res.cites.map((c) => ({ n: c.n, quote: c.quote, ok: c.ok, docName: c.docName, page: c.page })),
            model: cfg.model, ok: !res.bad,
          });
          refreshDocs();
        } catch (e) {
          out = { kind: 'error', message: e.message };
          paintOut();
        }
      }

      // ── 손놀림 ─────────────────────────────────────────────────────────────
      root.addEventListener('click', async (e) => {
        const hit = (sel) => e.target.closest(sel);

        if (hit('.ai-keyopen')) { keyOpen = true; return paintKey(); }
        if (hit('.ai-keyclose')) { keyOpen = false; return paintKey(); }
        if (hit('.ai-test')) {
          const btn = hit('.ai-test');
          btn.disabled = true; btn.textContent = '…';
          try {
            await loadLlm();
            const models = await AILLM.test(cfg);
            $('#ai-models').innerHTML = models.slice(0, 60).map((m) => `<option value="${esc(m)}">`).join('');
            MM.toast(`키가 통합니다 (모델 ${models.length}개)`);
          } catch (err) {
            MM.toast(err.message, true);
          }
          btn.disabled = false; btn.textContent = '시험';
          return;
        }

        if (hit('.ai-add')) {
          const name = prompt('작품 이름');
          if (!name) return;
          const res = await call('mod:ai:work', { op: 'add', name });
          if (res.error) return MM.toast(res.error, true);
          return load(res.work.id);
        }
        if (hit('.ai-ren')) {
          const w = works.find((x) => x.id === workId);
          const name = prompt('작품 이름', w?.name || '');
          if (!name) return;
          const res = await call('mod:ai:work', { op: 'rename', id: workId, name });
          if (res.error) return MM.toast(res.error, true);
          return load(workId);
        }
        if (hit('.ai-del')) {
          const w = works.find((x) => x.id === workId);
          if (!confirm(`「${w?.name}」 을(를) 지웁니다. 읽어 낸 내용도 함께 사라집니다.`)) return;
          const res = await call('mod:ai:work', { op: 'del', id: workId });
          if (res.error) return MM.toast(res.error, true);
          workId = null;
          return load();
        }
        if (hit('.ai-export')) {
          return window.open(`/api/gm/ai/work/${workId}/export?gm=${encodeURIComponent(ctx.token())}`);
        }
        if (hit('.ai-import')) return $('.ai-importin').click();

        if (hit('.ai-docdel')) {
          const id = hit('.ai-doc')?.dataset.id;
          const res = await call('mod:ai:doc', { op: 'del', id });
          if (res.error) return MM.toast(res.error, true);
          return refreshDocs();
        }
        if (hit('.ai-run')) return run();
        if (hit('.ai-stop')) { stop = true; return MM.toast('읽던 것을 마치고 멈춥니다'); }

        const modeBtn = hit('.ai-mode');
        if (modeBtn) { cfg.mode = modeBtn.dataset.mode; saveCfg(); return paintAsk(); }

        const chip = hit('.ai-chip');
        if (chip) {
          const q = $('.ai-q');
          q.value = CHIPS[Number(chip.dataset.i)][1];
          q.focus();
          return;
        }
        if (hit('.ai-send') || hit('.ai-find')) {
          const q = $('.ai-q').value.trim();
          if (!q) return MM.toast('물어볼 말을 적어 주세요', true);
          if (!workId) return MM.toast('먼저 작품을 고르세요', true);
          return hit('.ai-find') ? find(q) : send(q);
        }

        const head = hit('.ai-citehead');
        if (head) return head.parentElement.querySelector('.src').classList.toggle('hidden');

        const row = hit('.ai-histrow');
        if (row) {
          const a = asks.find((x) => x.id === row.dataset.id);
          if (a) {
            out = {
              kind: 'ask', q: a.question, model: a.model,
              found: !!a.answer, answer: a.answer,
              cites: (a.cites || []).map((c) => ({ ...c, text: c.text || '' })),
              bad: !a.ok,
            };
            paintOut();
          }
        }
      });

      root.addEventListener('change', async (e) => {
        if (e.target.matches('.ai-prov')) {
          cfg.provider = e.target.value;
          const p = PROVIDERS.find((x) => x.id === cfg.provider);
          if (p && !$('.ai-model').value.trim()) cfg.model = p.model;
          saveCfg(); return paintKey();
        }
        if (e.target.matches('.ai-worksel')) { workId = e.target.value || null; return load(workId); }
        if (e.target.matches('.ai-importin')) {
          const file = e.target.files[0];
          e.target.value = '';
          if (!file) return;
          const form = new FormData();
          form.append('data', file, file.name);
          try {
            const res = await MM.api('/api/gm/ai/import', { method: 'POST', body: form, headers: ctx.AUTH() });
            MM.toast(`불러왔습니다 — 자료 ${res.docs}건 · ${res.chunks}조각`);
            await load(res.workId);
          } catch (err) { MM.toast(err.message, true); }
        }
      });

      root.addEventListener('input', (e) => {
        if (e.target.matches('.ai-keyin')) { cfg.key = e.target.value.trim(); saveCfg(); }
        if (e.target.matches('.ai-model')) { cfg.model = e.target.value.trim(); saveCfg(); }
        if (e.target.matches('.ai-q')) MM.autoGrow(e.target, 140);
      });

      root.addEventListener('keydown', (e) => {
        if (e.target.matches('.ai-q') && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          $('.ai-send').click();
        }
      });

      // 폴더를 통째로 받는 자리. 안쪽(자료 목록)이 이기도록 여기에만 건다.
      MM.makeDropzone($('.ai-docs'), async (files, dt) => {
        const picked = dt ? await MM.filesFromDrop(dt) : files.map((f) => ({ file: f, path: f.name }));
        upload(picked);
      }, () => (workId ? '여기에 놓으면 이 작품의 자료가 됩니다' : null));

      paintAll();

      // 패널은 소켓보다 먼저 붙는다. 연결이 되면(그리고 다시 연결될 때마다) 한 벌을 받는다.
      const wait = setInterval(() => {
        if (!ctx.socket) return;
        clearInterval(wait);
        ctx.socket.on('connect', () => load());
        if (ctx.socket.connected) load();
      }, 150);
    },
  });
})();
