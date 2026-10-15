'use strict';
const { db } = require('podam/db');
const CHARS = require('./chars');

/**
 * 룸 셋팅(zip)에 담기는 부분.
 *
 * **GM이 만들어 둔 카드(NPC·적)와 기본 항목만** 담는다.
 * 플레이어의 카드는 그 회차의 것이라 담지 않는다 (룸 셋팅은 「준비물」이다).
 */
function collect(roomId) {
  return {
    statTemplate: CHARS.template(roomId),
    chars: CHARS.list(roomId, true)
      .filter((c) => !c.ownerId)
      .map((c) => ({
        name: c.name, imageFileId: c.imageFileId, stats: c.stats,
        status: c.status, note: c.note, hidden: c.hidden, sortOrder: c.sortOrder,
      })),
  };
}

function read(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = (v) => (typeof v === 'string' && /^[0-9a-f]{24}$/.test(v) ? v : null);
  const chars = (Array.isArray(raw.chars) ? raw.chars : []).slice(0, 60).map((c) => ({
    name: String(c?.name || '').slice(0, 20),
    imageFileId: id(c?.imageFileId),
    stats: Array.isArray(c?.stats) ? c.stats.slice(0, 12) : [],
    status: Array.isArray(c?.status) ? c.status.slice(0, 12) : [],
    note: String(c?.note || '').slice(0, 200),
    hidden: !!c?.hidden,
    sortOrder: Number(c?.sortOrder) || null,
  })).filter((c) => c.name);
  return {
    statTemplate: Array.isArray(raw.statTemplate) ? raw.statTemplate.slice(0, 12) : [],
    chars,
  };
}

/** 가져오기 트랜잭션 안에서 불린다. 파일 id는 새 방 것으로 바꿔 끼운다. */
function apply(roomId, data, mode, { fileMap } = {}) {
  if (!data) return 0;
  if (mode === 'replace') {
    // 플레이어가 만든 카드는 건드리지 않는다 (룸 셋팅의 몫이 아니다).
    db.prepare('DELETE FROM trpg_chars WHERE room_id = ? AND owner_id IS NULL').run(roomId);
  }
  if (data.statTemplate.length) CHARS.setTemplate(roomId, data.statTemplate);

  let added = 0;
  for (const c of data.chars) {
    const out = CHARS.save(roomId, { role: 'gm' }, {
      name: c.name, stats: c.stats, status: c.status, note: c.note, hidden: c.hidden,
    });
    if (out.error) continue;
    // 그림은 새 방의 파일 id로. 짝을 못 찾으면 그림 없이 둔다 (수치는 살린다).
    const fresh = c.imageFileId && fileMap ? fileMap.get(c.imageFileId) : null;
    if (fresh) CHARS.setImage(roomId, { role: 'gm' }, out.char.id, fresh);
    added++;
  }
  return added;
}

module.exports = { collect, read, apply };
