/* 🤖 AI 시나리오 보조 — 모델을 부르는 층.

   **키가 GM의 브라우저에만 있으므로 모델도 브라우저가 직접 부른다.**
   서버는 키를 보지도 받지도 않는다. 이 파일은 그 호출과, 지어낸 답을 막는
   프롬프트·검사만 맡는다. 화면은 ai.gm.js 가 그린다. */
(function (global) {
  'use strict';

  const OPENAI = 'https://api.openai.com/v1';
  const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';

  const TEXT_EXT = /\.(txt|md|csv)$/i;
  const CHUNK = 1200;                    // 조각 하나의 목표 길이 (글자)
  const MAX_INLINE_MB = 18;              // 이보다 크면 모델에 통째로 못 넣는다
  const MAX_OUT = 32768;                 // 한 번에 받을 글의 양 (토큰)
  const PER_ROUND = 6;                   // 한 번에 옮겨 적게 할 쪽 수
  const MAX_ROUNDS = 40;                 // 아무리 긴 자료라도 여기서 멈춘다

  // ── 자잘한 것들 ────────────────────────────────────────────────────────────

  /** 파일을 base64 로. (data: 앞머리는 떼고 알맹이만) */
  function toBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1] || '');
      r.onerror = () => reject(new Error('파일을 읽지 못했습니다'));
      r.readAsDataURL(blob);
    });
  }

  /** 모델이 ```json 울타리를 두르거나 앞뒤에 말을 붙여도 JSON만 건져 낸다. */
  function parseJson(text) {
    const s = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    try { return JSON.parse(s); } catch { /* 아래에서 한 번 더 */ }
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a >= 0 && b > a) {
      try { return JSON.parse(s.slice(a, b + 1)); } catch { /* 건져 내기로 넘긴다 */ }
    }
    return null;
  }

  /**
   * 글이 길어 **중간에서 잘린** JSON 에서 온전한 쪽만 건져 낸다.
   * 잘린 마지막 한 쪽은 버린다 — 반 토막 난 문장을 근거로 삼으면 안 되기 때문이다.
   */
  function salvage(text) {
    const s = String(text || '');
    const head = s.indexOf('"pages"');
    if (head < 0) return null;
    const out = [];
    let i = s.indexOf('{', head);
    while (i >= 0 && out.length < 200) {
      let depth = 0, quoted = false, esc = false, end = -1;
      for (let j = i; j < s.length; j++) {
        const c = s[j];
        if (esc) { esc = false; continue; }
        if (c === '\\') { esc = true; continue; }
        if (c === '"') { quoted = !quoted; continue; }
        if (quoted) continue;
        if (c === '{') depth++;
        else if (c === '}') { depth--; if (!depth) { end = j; break; } }
      }
      if (end < 0) break;                              // 여기서부터는 잘렸다
      try { out.push(JSON.parse(s.slice(i, end + 1))); } catch { /* 이 한 쪽만 버린다 */ }
      i = s.indexOf('{', end + 1);
    }
    return out.length ? { pages: out, more: true, salvaged: true } : null;
  }

  /** 긴 글을 문단 경계에서 잘라 조각으로. 쪽 번호는 그대로 물려준다. */
  function split(text, page, heading) {
    const out = [];
    let rest = String(text || '').trim();
    while (rest.length > CHUNK * 1.4) {
      let cut = rest.lastIndexOf('\n\n', CHUNK);
      if (cut < CHUNK * 0.4) cut = rest.lastIndexOf('\n', CHUNK);
      if (cut < CHUNK * 0.4) cut = rest.lastIndexOf(' ', CHUNK);
      if (cut < CHUNK * 0.4) cut = CHUNK;
      out.push({ page, heading, text: rest.slice(0, cut).trim() });
      rest = rest.slice(cut).trim();
    }
    if (rest) out.push({ page, heading, text: rest });
    return out;
  }

  // ── 제공자별 호출 ──────────────────────────────────────────────────────────

  async function jsonFetch(url, opt) {
    let res;
    try {
      res = await fetch(url, opt);
    } catch {
      throw new Error('모델에 연결하지 못했습니다 (인터넷 또는 키를 확인해 주세요)');
    }
    const body = await res.text();
    const data = (() => { try { return JSON.parse(body); } catch { return null; } })();
    if (!res.ok) {
      const why = data?.error?.message || body.slice(0, 200) || '';
      const hint = res.status === 401 || res.status === 403 ? ' — 키가 맞는지 보세요'
        : res.status === 404 ? ' — 모델 이름이 맞는지 보세요 (시험 단추로 목록을 받습니다)'
          : res.status === 429 ? ' — 한도에 걸렸습니다 (잠시 뒤에 다시)'
            : res.status === 413 ? ' — 파일이 너무 큽니다'
              : '';
      throw new Error(`${res.status}${hint}${why ? `: ${why}` : ''}`);
    }
    return data;
  }

  /**
   * 한 번 물어본다.
   * @param cfg   {provider, key, model}
   * @param o     {system, text, file:{mime, b64, name}, json, noThink}
   * @returns {text, truncated} — truncated 면 출력 한도에서 잘린 것이다
   */
  async function call(cfg, { system, text, file, json, noThink }) {
    if (!cfg?.key) throw new Error('API 키를 먼저 넣어 주세요');

    if (cfg.provider === 'gemini') {
      const parts = [{ text }];
      if (file) parts.push({ inline_data: { mime_type: file.mime, data: file.b64 } });
      const name = String(cfg.model || '').replace(/^models\//, '');
      const url = `${GEMINI}/models/${encodeURIComponent(name)}:generateContent`;
      const send = (extra) => jsonFetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: MAX_OUT,
            ...(json ? { responseMimeType: 'application/json' } : {}),
            ...extra,
          },
        }),
      });

      let data;
      try {
        // 옮겨 적기에는 '생각'이 필요 없다. 생각에 토큰을 다 쓰면 빈 답이 돌아온다.
        data = await send(noThink ? { thinkingConfig: { thinkingBudget: 0 } } : {});
      } catch (e) {
        if (!noThink || !/think/i.test(e.message)) throw e;
        data = await send({});                   // 이 모델은 생각을 못 끈다 — 그대로 부른다
      }

      const cand = data?.candidates?.[0];
      const out = (cand?.content?.parts || []).map((p) => p.text || '').join('').trim();
      if (!out) {
        const why = cand?.finishReason || data?.promptFeedback?.blockReason || '';
        throw new Error(
          /SAFETY|PROHIBITED|BLOCK/i.test(why) ? '모델이 이 자료를 거부했습니다 (안전 필터)'
            : why === 'MAX_TOKENS' ? '모델이 생각만 하다 답을 못 냈습니다 — 다른 모델로 해 보세요'
              : `모델이 빈 답을 보냈습니다${why ? ` (${why})` : ''}`);
      }
      return { text: out, truncated: cand?.finishReason === 'MAX_TOKENS' };
    }

    // OpenAI — Responses API (PDF·그림을 그대로 넣을 수 있다)
    const content = [{ type: 'input_text', text }];
    if (file) {
      content.push(/^image\//.test(file.mime)
        ? { type: 'input_image', image_url: `data:${file.mime};base64,${file.b64}` }
        : { type: 'input_file', filename: file.name || 'file.pdf', file_data: `data:${file.mime};base64,${file.b64}` });
    }
    const data = await jsonFetch(`${OPENAI}/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({
        model: cfg.model,
        instructions: system,
        input: [{ role: 'user', content }],
        max_output_tokens: MAX_OUT,
        ...(json ? { text: { format: { type: 'json_object' } } } : {}),
      }),
    });
    const out = typeof data?.output_text === 'string' && data.output_text.trim()
      ? data.output_text.trim()
      : (data?.output || []).flatMap((o) => o?.content || [])
        .map((c) => c?.text || '').join('').trim();
    if (!out) {
      const why = data?.incomplete_details?.reason || data?.status || '';
      throw new Error(why === 'max_output_tokens'
        ? '모델이 생각만 하다 답을 못 냈습니다 — 다른 모델로 해 보세요'
        : `모델이 빈 답을 보냈습니다${why ? ` (${why})` : ''}`);
    }
    return { text: out, truncated: data?.incomplete_details?.reason === 'max_output_tokens' };
  }

  /** 키가 통하는지, 쓸 수 있는 모델이 무엇인지 확인한다. */
  async function test(cfg) {
    if (!cfg?.key) throw new Error('키를 넣어 주세요');
    if (cfg.provider === 'gemini') {
      const data = await jsonFetch(`${GEMINI}/models`, { headers: { 'x-goog-api-key': cfg.key } });
      return (data?.models || []).map((m) => String(m.name || '').replace(/^models\//, ''))
        .filter((n) => /gemini/.test(n)).sort();
    }
    const data = await jsonFetch(`${OPENAI}/models`, { headers: { authorization: `Bearer ${cfg.key}` } });
    return (data?.data || []).map((m) => m.id).filter((id) => /^(gpt|o\d)/.test(id)).sort();
  }

  // ── ① 자료 읽기 ───────────────────────────────────────────────────────────

  const READ_SYS = [
    '너는 문서를 있는 그대로 옮겨 적는 도구다.',
    '요약하거나 다듬지 말고 적힌 글자를 그대로, 빠짐없이 옮겨라.',
    '없는 내용을 채워 넣지 마라. 읽을 수 없는 곳은 [읽을 수 없음] 이라고 적어라.',
    '그림·지도·표는 [그림: 보이는 것을 짧게] 처럼 보이는 것만 적어라. 뜻을 풀이하지 마라.',
    '반드시 JSON 만 출력한다:',
    '{"total":40,"pages":[{"page":1,"heading":"제목(없으면 빈 칸)","text":"그 쪽의 글 전부"}],"more":true}',
    '"total" 은 이 문서의 **전체 쪽 수**다 (문서 전체를 보고 세어라).',
    '"more" 는 아직 옮기지 않은 쪽이 남았으면 true 다.',
  ].join(' ');

  /**
   * 파일 하나를 읽어 조각으로 만든다.
   *
   * 글 파일(txt·md·csv)은 **모델을 거치지 않는다** — 공짜이고 더 정확하다.
   * PDF는 **몇 쪽씩 나눠** 옮겨 적게 한다. 한 번에 다 시키면 모델의 출력 한도에 걸려
   * 글이 중간에서 잘리기 때문이다.
   *
   * **모델의 「다 했다」(more:false)는 곧이곧대로 믿지 않는다.** 앞부분만 옮겨 적고
   * 끝났다고 하는 일이 잦다. 전체 쪽 수(total)를 받아 그 쪽까지 계속 조르고,
   * 더 이상 **새 쪽이 나오지 않을 때** 비로소 끝으로 본다.
   *
   * @param onStep 한 판이 끝날 때마다 (지금까지 읽은 마지막 쪽, 전체 쪽 수) 를 알려 준다
   * @returns [{page, heading, text}]  — 일부만 읽혔으면 error.pages 에 담아 던진다
   */
  async function readDoc(cfg, { blob, name, mime }, onStep) {
    if (TEXT_EXT.test(name || '') || /^text\/(plain|markdown|csv)/.test(mime || '')) {
      const text = await blob.text();
      if (!text.trim()) throw new Error('빈 파일입니다');
      return split(text, null, '');
    }

    const kind = String(mime || blob.type || '').toLowerCase();
    if (!/^image\//.test(kind) && !/pdf/.test(kind)) {
      throw new Error('이 형식은 읽을 수 없습니다 — PDF · 그림 · 글(txt·md·csv) 만 됩니다');
    }

    const mb = blob.size / (1024 * 1024);
    if (mb > MAX_INLINE_MB) {
      throw new Error(`파일이 큽니다 (${mb.toFixed(1)}MB) — 쪽을 나눠 올려 주세요`);
    }

    const b64 = await toBase64(blob);
    const file = { mime: mime || blob.type || 'application/pdf', b64, name };
    const isImage = /^image\//.test(kind);

    const out = [];
    let from = 1;
    let total = 0;                      // 모델이 알려 준 전체 쪽 수 (0 = 모름)
    let nudged = false;                 // 「앞쪽만 또 보냈다」고 한 번 다그쳤는가
    let stoppedBy = null;

    for (let round = 0; round < (isImage ? 1 : MAX_ROUNDS); round++) {
      const askText = isImage
        ? '이 그림에 보이는 글자를 모두 옮겨 적어라. 쪽 번호는 1, "total" 은 1, "more" 는 false 로 하라.'
        : `이 파일의 ${from}쪽부터 ${from + PER_ROUND - 1}쪽까지를 옮겨 적어라.`
          + ` **${from}쪽보다 앞은 이미 받았으니 다시 적지 마라.**`
          + ' 쪽 번호는 파일의 실제 쪽 번호로 적고, "total" 에 전체 쪽 수를 적어라.'
          + (nudged ? ' 앞서 같은 쪽을 또 보냈다. 이번에는 반드시 그다음 쪽부터 적어라.' : '');

      let got;
      try {
        got = await call(cfg, { system: READ_SYS, text: askText, file, json: true, noThink: true });
      } catch (e) {
        if (!out.length) throw e;              // 첫 판부터 실패하면 그대로 알린다
        stoppedBy = e;                         // 뒤쪽에서 막혔다 — 여기까지만 담는다
        break;
      }

      const data = parseJson(got.text) || salvage(got.text);
      const pages = Array.isArray(data?.pages) ? data.pages : [];
      if (!pages.length && !out.length) {
        throw new Error(data ? '읽어 낸 내용이 없습니다 (빈 문서일 수 있습니다)'
          : `모델이 형식을 지키지 않았습니다: ${got.text.slice(0, 120)}`);
      }

      const said = Number(data?.total);
      if (Number.isFinite(said) && said > total && said <= 2000) total = Math.round(said);

      let last = from - 1;
      for (const p of pages) {
        const page = Number(p?.page) || last + 1;
        if (!isImage && page < from) continue;          // 앞쪽을 또 보내면 버린다
        out.push(...split(p?.text, page, String(p?.heading || '').slice(0, 120)));
        last = Math.max(last, page);
      }

      if (last < from) {
        // 새 쪽이 없다. 한 번은 다그쳐 보고, 그래도 없으면 끝으로 본다.
        if (nudged || isImage) break;
        nudged = true;
        continue;
      }
      nudged = false;
      onStep?.(last, total);
      from = last + 1;
      if (isImage) break;

      // 모델의 「다 했다」는 **전체 쪽 수와 맞을 때만** 받아들인다.
      if (data.more === false && !data.salvaged && !got.truncated && (!total || from > total)) break;
      if (total && from > total) break;
    }

    if (!out.length) throw new Error('읽어 낸 내용이 없습니다');

    const read = from - 1;
    if (stoppedBy) {
      throw Object.assign(new Error(`${read}쪽까지만 읽었습니다 — ${stoppedBy.message}`),
        { pages: out, partial: true });
    }
    if (total && read < total) {
      // 모델이 중간에서 손을 놓았다. 읽은 데까지는 담되 **반드시 알린다.**
      throw Object.assign(new Error(`${total}쪽 가운데 ${read}쪽까지만 읽혔습니다`
        + ' — 다시 눌러 보거나, 자료를 나눠 올리면 끝까지 읽힙니다'),
      { pages: out, partial: true });
    }
    return out;
  }

  // ── ② 물어보기 ────────────────────────────────────────────────────────────

  /*
     답하는 방식은 두 가지다.

     - `strict` (자료 그대로) : 발췌에 적힌 것만 말한다. 없으면 없다고 한다.
     - `open`   (추론까지)    : 발췌로 답하되, 모자라면 **판단해서** 보탠다.

     어느 쪽이든 `answer` 에는 **발췌에 적힌 것만** 담고 인용으로 뒷받침한다.
     모델의 판단은 전부 `guess` 로 간다. 화면이 둘을 다른 칸에 그리므로
     GM은 「이건 시나리오에 쓰인 말, 저건 AI 생각」을 언제나 구별할 수 있다.
  */
  const ASK_COMMON = [
    '인용(quote)은 발췌에 있는 문장을 **한 글자도 바꾸지 말고** 그대로 옮겨라.',
    'answer 에는 **발췌에 적힌 것만** 적어라. 발췌에 없으면 answer 는 빈 칸으로 두고 found 를 false 로 하라.',
  ];

  const ASK_SYS = {
    strict: [
      '너는 주어진 발췌만 근거로 답하는 자료 안내원이다.',
      '발췌에 없는 것은 절대 지어내지 마라. 일반 상식이나 다른 작품의 내용을 끌어오지 마라.',
      ...ASK_COMMON,
      '반드시 JSON 만 출력한다:',
      '{"found":true,"answer":"발췌에 적힌 답","cites":[{"n":1,"quote":"발췌의 문장 그대로"}]}',
    ].join(' '),

    open: [
      '너는 머더미스터리·TRPG 진행자(GM)를 돕는 조수다. 자료를 읽고 **판단해서** 도와라.',
      ...ASK_COMMON,
      '발췌만으로 모자라면 guess 에 네 판단을 적어라 — 발췌에서 끌어낸 추론, 진행 요령, 제안 무엇이든 좋다.',
      'guessFrom 에는 그 판단의 발판이 된 발췌 번호를 적어라 (발판이 없으면 빈 배열).',
      '발췌에 없는 바깥 지식(일반 룰 상식·다른 작품)에 기댔으면 beyond 를 true 로 하라.',
      '**자료에 쓰인 말과 네 판단을 절대 섞지 마라.** 쓰여 있지 않은 것을 answer 에 넣으면 안 된다.',
      '반드시 JSON 만 출력한다:',
      '{"found":true,"answer":"발췌에 적힌 답(없으면 빈 칸)","cites":[{"n":1,"quote":"발췌의 문장 그대로"}],'
        + '"guess":"네 판단(없으면 빈 칸)","guessFrom":[1,2],"beyond":false}',
    ].join(' '),
  };

  /** 발췌를 번호 붙은 글로. 번호는 화면의 각주 번호와 같다. */
  function excerpts(hits) {
    return hits.map((h, i) => {
      const where = [h.docName, h.page ? `${h.page}쪽` : '', h.heading].filter(Boolean).join(' · ');
      return `[${i + 1}] ${where}\n${h.text}`;
    }).join('\n\n---\n\n');
  }

  /** 인용이 진짜 그 발췌에 있는지 본다 (공백·따옴표는 흘려서 견준다). */
  const loose = (s) => String(s || '').toLowerCase().replace(/[\s"'`“”‘’·.,!?()[\]{}—–-]+/g, '');

  function verify(hits, cites) {
    return (Array.isArray(cites) ? cites : []).slice(0, 12).map((c) => {
      const n = Number(c?.n);
      const hit = hits[n - 1] || null;
      const quote = String(c?.quote || '').trim().slice(0, 500);
      return {
        n: hit ? n : 0,
        quote,
        chunkId: hit?.id || null,
        docName: hit?.docName || '',
        page: hit?.page || null,
        text: hit?.text || '',
        ok: !!(hit && quote && loose(hit.text).includes(loose(quote))),
      };
    });
  }

  /**
   * 묻는다.
   *
   * @param mode 'strict' = 자료에 적힌 것만 · 'open' = 모자라면 판단도 보탠다
   * @returns {found, answer, cites, guess, guessFrom, beyond, bad}
   *          answer = **자료에 적힌 것**(인용으로 뒷받침) · guess = **모델의 판단**
   *          bad    = 근거가 하나도 원문과 맞지 않는다 (=answer 를 믿으면 안 된다)
   */
  async function ask(cfg, question, hits, mode = 'strict') {
    const open = mode === 'open';
    const system = open ? ASK_SYS.open : ASK_SYS.strict;

    if (!hits.length) {
      // 자료에서 걸리는 대목이 없다. 「자료 그대로」면 여기서 끝.
      if (!open) return { found: false, answer: '', cites: [], guess: '', guessFrom: [], beyond: false, bad: false };
      // 「추론까지」면 **자료 밖 지식임을 못박고** 물어본다.
      const out = parseJson((await call(cfg, {
        system, json: true,
        text: '자료에서 이 질문과 맞는 대목을 찾지 못했다. 발췌가 없으므로 answer 는 빈 칸,'
          + ' found 는 false, beyond 는 true 로 두고, guess 에만 네 판단을 적어라.'
          + `

질문: ${question}`,
      })).text);
      return {
        found: false, answer: '', cites: [],
        guess: String(out?.guess || '').trim().slice(0, 8000),
        guessFrom: [], beyond: true, bad: false,
      };
    }

    const body = `발췌:

${excerpts(hits)}

---

질문: ${question}`;
    let data = parseJson((await call(cfg, { system, text: body, json: true })).text);
    if (!data) {
      // 한 번만 다시 묻는다. 그래도 형식을 안 지키면 실패로 둔다 — 꾸며 내지 않는다.
      data = parseJson((await call(cfg, {
        system, json: true,
        text: `${body}

(앞선 답이 형식을 벗어났다. JSON 만 출력하라.)`,
      })).text);
    }
    if (!data) throw new Error('모델이 형식을 지키지 않았습니다');

    const cites = verify(hits, data.cites);
    const found = data.found === true && !!String(data.answer || '').trim();
    return {
      found,
      answer: found ? String(data.answer).trim().slice(0, 8000) : '',
      cites,
      guess: open ? String(data.guess || '').trim().slice(0, 8000) : '',
      guessFrom: (Array.isArray(data.guessFrom) ? data.guessFrom : [])
        .map(Number).filter((n) => n >= 1 && n <= hits.length).slice(0, 12),
      beyond: open && data.beyond === true,
      bad: found && cites.length > 0 && cites.every((c) => !c.ok),
    };
  }

  global.AILLM = { call, test, readDoc, ask, verify, parseJson, salvage, split, toBase64, CHUNK };
})(window);
