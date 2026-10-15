'use strict';

/**
 * 🤖 AI 시나리오 보조의 표.
 *
 * 여기에는 **자료의 원문과 그 조각**만 쌓인다. API 키는 GM의 브라우저에만 있고
 * 서버로 오지 않는다 — 그래서 키를 담는 칸도 없다.
 *
 * 「작품」 하나가 시나리오 한 편이다. 작품 아래에 문서가 있고, 문서 아래에
 * 조각이 있다. 답변의 근거는 반드시 조각 한 줄을 가리킨다.
 */
module.exports = function schema(db, _addColumn) {
  db.exec(`
-- 시나리오 한 편의 자료 묶음. 한 방에 여러 편을 둘 수 있다.
CREATE TABLE IF NOT EXISTS ai_works (
  id         TEXT PRIMARY KEY,
  room_id    TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  note       TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_work ON ai_works(room_id, created_at);

-- 자료 한 장. status: 'wait'(아직) | 'busy'(읽는 중) | 'done' | 'fail'
-- path 는 폴더를 통째로 끌어다 놓았을 때의 폴더 안 경로다 (보여주기용).
CREATE TABLE IF NOT EXISTS ai_docs (
  id         TEXT PRIMARY KEY,
  room_id    TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  work_id    TEXT NOT NULL,
  file_id    TEXT,
  name       TEXT NOT NULL,
  path       TEXT,
  mime       TEXT,
  bytes      INTEGER,
  pages      INTEGER,
  chars      INTEGER,
  status     TEXT NOT NULL DEFAULT 'wait',
  error      TEXT,
  sort_order INTEGER,
  created_at INTEGER NOT NULL,
  done_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_ai_doc      ON ai_docs(work_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_ai_doc_file ON ai_docs(file_id);

-- 읽어 낸 원문 조각. 답변의 근거는 언제나 이 표의 한 줄이다.
CREATE TABLE IF NOT EXISTS ai_chunks (
  id      TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  work_id TEXT NOT NULL,
  doc_id  TEXT NOT NULL,
  idx     INTEGER NOT NULL,
  page    INTEGER,
  heading TEXT,
  text    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_chunk ON ai_chunks(work_id, doc_id, idx);

-- 문답 기록. 무엇을 물었고 무엇을 근거로 답했는지 남긴다.
CREATE TABLE IF NOT EXISTS ai_asks (
  id         TEXT PRIMARY KEY,
  room_id    TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  work_id    TEXT NOT NULL,
  gm_id      TEXT,
  nickname   TEXT,
  question   TEXT NOT NULL,
  answer     TEXT,
  cites      TEXT,
  model      TEXT,
  ok         INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_ask ON ai_asks(work_id, created_at);
`);
};
