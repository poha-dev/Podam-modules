'use strict';

/**
 * 🎲 간이 TRPG 모듈의 표.
 *
 * 이 앱은 GM ↔ 플레이어 1:1이 원칙이라 `messages` 는 언제나 한 사람의 스레드에 묶인다.
 * 공용 무대는 그 반대 — 방에 있는 모두가 같은 줄을 본다. 그래서 표부터 갈라 둔다.
 * 실수로 1:1 대화가 공용으로 새는 일이 구조적으로 불가능해야 하기 때문이다.
 */
module.exports = function schema(db) {
  db.exec(`
-- 방마다 하나. 지금 무대에 무엇이 떠 있는지.
CREATE TABLE IF NOT EXISTS trpg_board (
  room_id        TEXT PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
  bg_file_id     TEXT,                              -- 가운데 배경 그림
  bgm_file_id    TEXT,                              -- 지금 트는 곡
  bgm_playing    INTEGER NOT NULL DEFAULT 0,
  bgm_loop       INTEGER NOT NULL DEFAULT 1,
  bgm_volume     REAL    NOT NULL DEFAULT 0.6,      -- GM이 권하는 크기 (듣는 사람이 더 줄일 수 있다)
  bgm_started_at INTEGER,                           -- 늦게 들어온 사람의 재생 위치를 대충 맞추는 데 쓴다
  ov_file_id     TEXT,                              -- 따로 띄우는 그림 (지도 등) — 3단계
  ov_x           REAL    NOT NULL DEFAULT 0.5,      -- 0~1 비율로 둔다. 화면 크기가 달라도 같은 자리에 보이게.
  ov_y           REAL    NOT NULL DEFAULT 0.5,
  ov_w           REAL    NOT NULL DEFAULT 0.4,
  ov_shown       INTEGER NOT NULL DEFAULT 0,
  updated_at     INTEGER NOT NULL
);

-- GM이 미리 등록해 두는 배경·BGM 목록. files 행(자료함)을 가리키기만 한다.
CREATE TABLE IF NOT EXISTS trpg_assets (
  id         TEXT PRIMARY KEY,
  room_id    TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,                         -- 'bg' | 'bgm' | 'ov'
  file_id    TEXT NOT NULL,
  label      TEXT,
  sort_order INTEGER,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_trpg_asset_one  ON trpg_assets(room_id, kind, file_id);
CREATE INDEX        IF NOT EXISTS idx_trpg_asset_list ON trpg_assets(room_id, kind, sort_order);

-- 공용 대화. 여기 적힌 것은 방에 있는 모두가 본다.
CREATE TABLE IF NOT EXISTS trpg_messages (
  id             TEXT PRIMARY KEY,
  room_id        TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  sender         TEXT NOT NULL,                     -- 'gm' | 'player' | 'system'
  gm_id          TEXT,
  participant_id TEXT,
  nickname       TEXT,                              -- 그때의 이름을 찍어 둔다 (이름을 바꾸거나 나가도 기록은 그대로)
  kind           TEXT NOT NULL,                     -- 'text' | 'file' | 'dice'
  body           TEXT,
  file_id        TEXT,
  meta           TEXT,                              -- 주사위 결과 등 (2단계)
  created_at     INTEGER NOT NULL,
  deleted_at     INTEGER,
  deleted_by     TEXT
);
CREATE INDEX IF NOT EXISTS idx_trpg_msg  ON trpg_messages(room_id, created_at);
CREATE INDEX IF NOT EXISTS idx_trpg_file ON trpg_messages(file_id);

-- 굴린 기록. 눈은 언제나 서버가 정하므로, 여기 남은 것이 유일한 근거다.
-- GM의 비밀 굴림도 여기에는 남는다 (공용 대화에는 남기지 않는다).
CREATE TABLE IF NOT EXISTS trpg_rolls (
  id         TEXT PRIMARY KEY,
  room_id    TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  sender     TEXT NOT NULL,                     -- 'gm' | 'player'
  actor_id   TEXT,
  nickname   TEXT,
  notation   TEXT NOT NULL,                     -- 다듬은 식
  detail     TEXT NOT NULL,                     -- 눈을 끼워 넣은 식
  total      REAL NOT NULL,
  dice       TEXT NOT NULL,                     -- [{sides,value}] JSON
  strength   REAL,                              -- 파워 게이지 0~1
  secret     INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trpg_roll ON trpg_rolls(room_id, created_at);

`);
};
