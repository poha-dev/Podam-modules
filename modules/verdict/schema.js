'use strict';

/**
 * 정답 판정 모듈의 표.
 *
 * 배역마다 「정답:답변」 짝을 잔뜩 등록해 두고, 그 배역을 맡은 사람이 정답을
 * 제출하면 짝지어진 답변이 자동으로 나간다. 같은 정답이라도 배역마다 다른
 * 답변이 나갈 수 있다 (role_id 로 갈라 둔다).
 */
module.exports = function schema(db) {
  // 예전 시험판에서 쓰던 표를 치운다. 칸 구성이 달라 그대로 두면
  // 「서버 오류」가 나므로, 남아 있으면 지우고 새로 만든다.
  db.exec(`
DROP TABLE IF EXISTS verdict_hits;
DROP TABLE IF EXISTS verdict_tries;
DROP TABLE IF EXISTS verdict_keys;
`);

  const cols = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (cols('verdict_settings').length && !cols('verdict_settings').includes('miss')) {
    db.exec('DROP TABLE verdict_settings');
  }
  if (cols('verdict_settings').includes('miss') && !cols('verdict_settings').includes('gm_feed')) {
    db.exec("ALTER TABLE verdict_settings ADD COLUMN gm_feed TEXT NOT NULL DEFAULT 'hit'");
  }

  db.exec(`
-- 방마다 하나. 답변을 누구 이름으로 보낼지, 못 찾았을 때 어떻게 할지.
CREATE TABLE IF NOT EXISTS verdict_settings (
  room_id    TEXT PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
  npc_name   TEXT,                                -- 비우면 이름 없이
  gm_feed    TEXT NOT NULL DEFAULT 'hit',         -- 'all' | 'hit' | 'none' (GM에게 어디까지 알릴지)
  miss       TEXT NOT NULL DEFAULT 'notice',      -- 'notice' | 'silent'
  miss_text  TEXT,
  updated_at INTEGER NOT NULL
);

-- 정답:답변 짝. role_id 가 비어 있으면 모든 배역에 통하는 공용이다.
CREATE TABLE IF NOT EXISTS verdict_entries (
  id         TEXT PRIMARY KEY,
  room_id    TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  role_id    TEXT,
  answer     TEXT NOT NULL,          -- 적어 둔 그대로 (비교는 다듬어서 한다)
  norm       TEXT NOT NULL,          -- 띄어쓰기·구두점을 없앤 비교용
  reply      TEXT NOT NULL,
  sort_order INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_verdict_entry ON verdict_entries(room_id, role_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_verdict_norm ON verdict_entries(room_id, norm);

-- 누가 무엇을 물었고 맞았는지 (GM 화면의 기록용).
CREATE TABLE IF NOT EXISTS verdict_log (
  id             TEXT PRIMARY KEY,
  room_id        TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL,
  asked          TEXT NOT NULL,
  entry_id       TEXT,               -- 맞으면 그 짝, 못 찾으면 비어 있다
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_verdict_log ON verdict_log(room_id, created_at);
`);
};
