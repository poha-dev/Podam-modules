'use strict';
const E = require('./engine');
const { db } = require('podam/db');

/**
 * 룸 셋팅(zip)에 담기는 부분.
 * 정답표와 설정만 담는다 — 누가 무엇을 물었는지는 담지 않는다.
 * 배역은 **이름**으로 적어 둔다. 새 방에서 같은 이름의 배역에 자동으로 붙는다.
 */
function collect(roomId) {
  const roles = db.prepare('SELECT id, name FROM roles WHERE room_id = ? ORDER BY sort, created_at').all(roomId);
  return {
    settings: E.settings(roomId),
    tables: [{ role: null, text: E.format(roomId, null) }]
      .concat(roles.map((r) => ({ role: r.name, text: E.format(roomId, r.id) })))
      .filter((t) => t.text),
  };
}

function read(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const tables = (Array.isArray(raw.tables) ? raw.tables : []).slice(0, 200).map((t) => ({
    role: t?.role ? String(t.role).trim().slice(0, 30) : null,
    text: String(t?.text || '').slice(0, 200000),
  })).filter((t) => t.text);

  const s = raw.settings && typeof raw.settings === 'object' ? raw.settings : null;
  return {
    settings: s ? {
      npcName: s.npcName ? String(s.npcName).trim().slice(0, 30) : '',
      miss: s.miss === 'silent' ? 'silent' : 'notice',
      missText: s.missText ? String(s.missText).trim().slice(0, 300) : '',
    } : null,
    tables,
  };
}

/** 가져오기 트랜잭션 안에서 불린다. 배역 이름으로 새 방의 배역을 찾아 붙인다. */
function apply(roomId, data, mode) {
  if (!data) return 0;
  if (mode === 'replace') db.prepare('DELETE FROM verdict_entries WHERE room_id = ?').run(roomId);
  if (data.settings) E.saveSettings(roomId, data.settings);

  // 「[배역이름] … 」 한 덩어리로 만들어 기존 들여오기 길을 그대로 쓴다.
  const text = data.tables
    .map((t) => `[${t.role || '공용'}]\n${t.text}`)
    .join('\n\n');
  const { added } = E.importText(roomId, text, 'merge');
  return added;
}

module.exports = { collect, read, apply };
