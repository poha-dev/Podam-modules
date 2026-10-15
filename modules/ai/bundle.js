'use strict';
const { db } = require('podam/db');
const W = require('./works');
const P = require('./portable');

/**
 * 룸 셋팅(zip)에 담기는 부분.
 *
 * 작품과 자료 목록, 그리고 **들어가면** 읽어 낸 조각까지 담는다.
 * 룸 셋팅의 모듈 칸은 전부 합쳐 512KB 를 넘을 수 없으므로(`src/bundle.js`),
 * 조각이 그보다 크면 **조각은 빼고 목록만** 담는다. 그 경우 가져온 방에서는
 * 자료가 「아직 안 읽음」으로 들어와 원본만 있으면 다시 읽으면 된다.
 * 조각만 따로 주고받고 싶을 때는 모듈 화면의 내보내기(`.mmai.json`)를 쓴다.
 *
 * 문답 기록은 담지 않는다 — 누가 무엇을 물었는지는 그 방의 일이다.
 */
const BUDGET = 300 * 1024;             // 조각까지 담을지 정하는 기준

function collect(roomId) {
  const works = W.list(roomId).map((w) => P.collectWork(roomId, w.id)).filter(Boolean);
  if (!works.length) return null;

  const slim = works.map((w) => ({ work: w.work, docs: w.docs, chunks: w.chunks }));
  const out = { works: slim };
  if (JSON.stringify(out).length > BUDGET) {
    // 너무 크다 — 목록만 담는다.
    return { works: slim.map((w) => ({ work: w.work, docs: w.docs, chunks: [] })), trimmed: true };
  }
  return out;
}

function read(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const works = (Array.isArray(raw.works) ? raw.works : []).slice(0, W.MAX_WORKS)
    .map((w) => P.read({ format: P.FORMAT, ...w }))
    .filter(Boolean);
  return works.length ? { works } : null;
}

/** 가져오기 트랜잭션 안에서 불린다. 원본 파일은 fileMap 으로 새 id 를 찾는다. */
function apply(roomId, data, mode, { fileMap } = {}) {
  if (!data) return 0;
  if (mode === 'replace') {
    for (const w of db.prepare('SELECT id FROM ai_works WHERE room_id = ?').all(roomId)) {
      W.remove(roomId, w.id);
    }
  }
  let n = 0;
  for (const w of data.works) {
    const out = P.apply(roomId, w, { fileMap });
    if (out.ok) n += out.docs;
    // 조각이 하나도 없으면 「아직 안 읽음」으로 되돌려 다시 읽을 수 있게 한다.
    if (out.ok && !w.chunks.length) {
      db.prepare('UPDATE ai_docs SET status = \'wait\', done_at = NULL WHERE work_id = ?').run(out.workId);
    }
  }
  return n;
}

module.exports = { collect, read, apply };
