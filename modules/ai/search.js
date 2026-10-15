'use strict';
const C = require('./chunks');

/**
 * 질문에 맞는 원문 조각 고르기.
 *
 * SQLite 의 FTS5 를 쓰지 않는다. 기본 토크나이저는 띄어쓰기로 자르기 때문에
 * 한국어에서는 「알리바이가」와 「알리바이」가 서로 다른 말이 되어 버린다.
 * 대신 **글자 2개씩 겹쳐 세는 방식(2-gram)** 으로 점수를 매긴다.
 * 조각은 한 작품에 많아야 수천 줄이라 이 정도 계산은 눈 깜짝할 새다.
 */
const MAX_HITS = 12;                   // 모델에 함께 넣을 조각 수
const MAX_CHARS = 12000;               // 조각을 합쳐 이 길이를 넘기지 않는다

/** 견줄 수 있게 다듬는다 — 소문자, 문장부호·공백 제거. */
const norm = (s) => String(s || '').toLowerCase().replace(/[\s.,!?"'`~()[\]{}<>:;/\|_\-–—…·]+/g, '');

function grams(s) {
  const t = norm(s);
  const out = new Set();
  if (t.length === 1) out.add(t);
  for (let i = 0; i + 2 <= t.length; i++) out.add(t.slice(i, i + 2));
  return out;
}

/** 질문에서 뽑은 낱말 중 그대로 들어 있으면 크게 쳐 준다 (이름·고유명사). */
function words(q) {
  return String(q || '')
    .split(/[\s.,!?"'`~()[\]{}<>:;/\|]+/)
    .map((w) => norm(w))
    .filter((w) => w.length >= 2)
    .slice(0, 12);
}

/**
 * @param chunks  C.all() 이 돌려준 조각들
 * @param q       질문 또는 찾을 말
 * @returns 점수 높은 순, 합쳐서 MAX_CHARS 안쪽
 */
function rank(chunks, q, { limit = MAX_HITS, maxChars = MAX_CHARS } = {}) {
  const qg = grams(q);
  const qw = words(q);
  if (!qg.size) return [];

  const scored = [];
  for (const c of chunks) {
    const body = norm(c.text);
    const head = norm(`${c.heading || ''} ${c.docName || ''}`);
    let hit = 0;
    for (const g of qg) if (body.includes(g) || head.includes(g)) hit++;
    if (!hit) continue;

    let score = hit / qg.size;
    for (const w of qw) {
      if (body.includes(w)) score += 0.35;            // 낱말이 통째로 있다
      if (head.includes(w)) score += 0.15;            // 제목·파일 이름에 있다
    }
    // 짧은 조각이 우연히 맞은 것보다, 내용이 있는 조각을 살짝 위로.
    score += Math.min(0.1, c.text.length / 40000);
    scored.push({ ...c, score: Math.round(score * 1000) / 1000 });
  }

  scored.sort((a, b) => b.score - a.score);

  const out = [];
  let chars = 0;
  for (const c of scored) {
    if (out.length >= limit) break;
    if (chars + c.text.length > maxChars && out.length) break;
    out.push(c);
    chars += c.text.length;
  }
  return out;
}

/** 방·작품을 확인한 뒤 고른다. */
function search(roomId, workId, q, opts = {}) {
  const docIds = Array.isArray(opts.docIds) && opts.docIds.length ? new Set(opts.docIds) : null;
  const pool = C.all(roomId, workId).filter((c) => !docIds || docIds.has(c.docId));
  return rank(pool, q, opts);
}

module.exports = { MAX_HITS, MAX_CHARS, norm, grams, rank, search };
