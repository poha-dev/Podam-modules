'use strict';

/**
 * 정답 맞추기 판정. DB를 모르는 순수 함수만 둔다 (그래야 따로 시험하기 쉽다).
 *
 * 한국어는 조사가 붙고 띄어쓰기가 제각각이라 그대로 비교하면 거의 안 맞는다.
 *   "범인은 집 사 입니다!"  ← 이것도 '집사'로 맞춰야 한다.
 * 그래서 비교 전에 공백과 문장부호를 전부 없애고 소문자로 맞춘 뒤,
 * 키워드가 그 안에 들어 있는지를 본다. 조사를 떼는 규칙은 만들지 않는다 —
 * '사과가' 를 '사과' 로 자르려다 멀쩡한 말을 망가뜨리는 쪽이 더 위험하다.
 */

// 지울 문장부호. 한글 따옴표와 가운뎃점까지 포함한다.
const PUNCT = /[\s.,!?~·…\-_/\\()[\]{}"'`’‘“”「」『』:;<>@#$%^&*+=|]/g;

/** 비교용으로 다듬은 문자열. 빈 문자열이 나오면 키워드로 쓸 수 없다. */
function norm(s) {
  return String(s ?? '').normalize('NFC').toLowerCase().replace(PUNCT, '');
}

/** 이 발화가 키워드에 걸리는가. mode: 'contains' | 'exact' */
function hits(text, keywords, mode = 'contains') {
  const t = norm(text);
  if (!t) return null;
  for (const raw of keywords || []) {
    const k = norm(raw);
    if (!k) continue;
    if (mode === 'exact' ? t === k : t.includes(k)) return raw;
  }
  return null;
}

/**
 * 명령 모드에서 쓸 접두사를 떼어낸다.
 * "/답 집사" → "집사". 접두사가 없으면 null (그냥 대화라는 뜻).
 */
function stripTrigger(body, trigger) {
  const text = String(body ?? '').trim();
  const list = [trigger, '/답', '/answer', '/정답'].filter(Boolean);
  for (const t of list) {
    if (text === t) return '';
    if (text.toLowerCase().startsWith(`${String(t).toLowerCase()} `)) {
      return text.slice(t.length).trim();
    }
  }
  return null;
}

module.exports = { norm, hits, stripTrigger };
