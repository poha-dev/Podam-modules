'use strict';

/**
 * 👥 캐릭터 카드의 표.
 *
 * 🎲 간이 TRPG 무대에 얹혀 쓰는 **확장 모듈**이라 표도 따로 둔다.
 * 이 모듈만 끄면 카드는 화면에서 사라지지만 기록은 그대로 남는다.
 */
module.exports = function schema(db, addColumn) {
  db.exec(`
-- 캐릭터 카드. 그림과 수치(HP·MP 같은 것), 상태이상을 들고 있다.
-- 룰마다 항목이 달라 정해진 칸을 만들지 않고 JSON 한 줄로 둔다.
CREATE TABLE IF NOT EXISTS trpg_chars (
  id            TEXT PRIMARY KEY,
  room_id       TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  owner_id      TEXT,                              -- participants.id · 비어 있으면 GM의 것(NPC)
  name          TEXT NOT NULL,
  image_file_id TEXT,
  stats         TEXT NOT NULL,                     -- [{label,cur,max}] 적은 순서 그대로
  status        TEXT NOT NULL,                     -- ["중독","기절"]
  note          TEXT,
  hidden        INTEGER NOT NULL DEFAULT 0,        -- GM만 보는 카드 (적·숨은 NPC)
  sort_order    INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trpg_char ON trpg_chars(room_id, sort_order);

-- 방마다 하나. 새 카드가 물려받을 기본 항목.
CREATE TABLE IF NOT EXISTS trpg_char_setup (
  room_id       TEXT PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
  stat_template TEXT NOT NULL,
  updated_at    INTEGER NOT NULL
);
`);

  // 무대 위에 올려 둔 토큰의 자리.
  // **배경 그림 안에서의 비율(0~1)** 로 둔다 — 화면 크기가 달라도 모두 같은 곳을 가리키게.
  addColumn?.('trpg_chars', 'on_stage', 'INTEGER NOT NULL DEFAULT 0');
  addColumn?.('trpg_chars', 'pos_x', 'REAL NOT NULL DEFAULT 0.5');
  addColumn?.('trpg_chars', 'pos_y', 'REAL NOT NULL DEFAULT 0.5');
};
