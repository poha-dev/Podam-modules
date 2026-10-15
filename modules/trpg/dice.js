'use strict';
const crypto = require('crypto');

/**
 * 주사위 — **눈은 언제나 서버가 정한다.**
 *
 * 화면은 애니메이션만 한다. 그래야 모두가 같은 숫자를 보고, 굴린 사람이
 * 브라우저에서 값을 바꿔치기할 수 없다.
 *
 * 쓸 수 있는 식:  1d20 + 3   ·   2d6*2   ·   (1d8+2)*3 - 1d4/2
 *   - 주사위: <개수>d<면수>  (개수를 비우면 1개)
 *   - 사칙연산 + - * / 와 괄호
 */

// d3 is common in Call of Cthulhu scenarios for recovery and bonus values.
// It does not need a dedicated 3D model: clients can render it generically.
const SIDES = [3, 4, 6, 8, 10, 12, 20, 100];
const MAX_DICE = 30;                             // 한 번에 굴릴 수 있는 개수
const MAX_TEXT = 120;

const roll1 = (sides) => crypto.randomInt(1, sides + 1);   // Math.random 은 쓰지 않는다

// ── 식 읽기 ────────────────────────────────────────────────────────────────
// 작은 식 하나를 다루는 것이므로 직접 읽는다. eval 류는 절대 쓰지 않는다.

function tokenize(src) {
  const out = [];
  let i = 0;
  const text = src.replace(/\s+/g, '').toLowerCase();
  while (i < text.length) {
    const c = text[i];
    if ('+-*/()'.includes(c)) { out.push({ t: c }); i++; continue; }

    const m = /^(\d*)d(\d+)|^(\d+(?:\.\d+)?)/.exec(text.slice(i));
    if (!m) throw new Error(`알 수 없는 글자입니다: ${c}`);
    i += m[0].length;

    if (m[2] !== undefined) {
      const n = m[1] === '' ? 1 : Number(m[1]);
      const sides = Number(m[2]);
      if (!SIDES.includes(sides)) throw new Error(`d${sides} 는 굴릴 수 없습니다 (${SIDES.map((s) => 'd' + s).join(' · ')})`);
      if (!(n >= 1)) throw new Error('주사위 개수가 이상합니다');
      out.push({ t: 'dice', n, sides });
    } else {
      out.push({ t: 'num', v: Number(m[3]) });
    }
  }
  return out;
}

/** 토큰 → 식 나무. 곱셈·나눗셈을 먼저 묶는다. */
function parse(tokens) {
  let p = 0;
  const peek = () => tokens[p];
  const eat = (t) => { if (peek()?.t === t) { p++; return true; } return false; };

  function primary() {
    const tk = peek();
    if (!tk) throw new Error('식이 덜 끝났습니다');
    if (eat('(')) {
      const node = expr();
      if (!eat(')')) throw new Error('괄호를 닫지 않았습니다');
      return { k: 'paren', a: node };
    }
    if (eat('-')) return { k: 'neg', a: primary() };
    if (eat('+')) return primary();
    p++;
    if (tk.t === 'num') return { k: 'num', v: tk.v };
    if (tk.t === 'dice') return { k: 'dice', n: tk.n, sides: tk.sides };
    throw new Error('식을 읽을 수 없습니다');
  }

  function term() {
    let node = primary();
    for (;;) {
      if (eat('*')) node = { k: 'op', op: '*', a: node, b: primary() };
      else if (eat('/')) node = { k: 'op', op: '/', a: node, b: primary() };
      else return node;
    }
  }

  function expr() {
    let node = term();
    for (;;) {
      if (eat('+')) node = { k: 'op', op: '+', a: node, b: term() };
      else if (eat('-')) node = { k: 'op', op: '-', a: node, b: term() };
      else return node;
    }
  }

  const node = expr();
  if (p !== tokens.length) throw new Error('식을 읽을 수 없습니다');
  return node;
}

/** 주사위를 실제로 굴리면서 값을 채운다. 굴린 순서를 그대로 남긴다. */
function evaluate(node, dice) {
  switch (node.k) {
    case 'num': return node.v;
    case 'paren': return evaluate(node.a, dice);
    case 'neg': return -evaluate(node.a, dice);
    case 'dice': {
      const values = [];
      for (let i = 0; i < node.n; i++) {
        const v = roll1(node.sides);
        values.push(v);
        dice.push({ sides: node.sides, value: v });
      }
      node.values = values;
      return values.reduce((s, v) => s + v, 0);
    }
    case 'op': {
      const a = evaluate(node.a, dice);
      const b = evaluate(node.b, dice);
      if (node.op === '+') return a + b;
      if (node.op === '-') return a - b;
      if (node.op === '*') return a * b;
      if (b === 0) throw new Error('0으로 나눌 수 없습니다');
      return a / b;
    }
    default: throw new Error('식을 읽을 수 없습니다');
  }
}

/** 다듬은 식 (1d4 + 3d6 꼴) */
function show(node) {
  switch (node.k) {
    case 'num': return num(node.v);
    case 'dice': return `${node.n}d${node.sides}`;
    case 'paren': return `(${show(node.a)})`;
    case 'neg': return `-${show(node.a)}`;
    case 'op': return `${show(node.a)} ${node.op} ${show(node.b)}`;
    default: return '';
  }
}

/** 굴린 눈을 식에 끼워 넣은 것 (3 + (2 + 3 + 5) 꼴) */
function showValues(node) {
  switch (node.k) {
    case 'num': return num(node.v);
    case 'dice':
      return node.values.length === 1
        ? String(node.values[0])
        : `(${node.values.join(' + ')})`;
    case 'paren': return `(${showValues(node.a)})`;
    case 'neg': return `-${showValues(node.a)}`;
    case 'op': return `${showValues(node.a)} ${node.op} ${showValues(node.b)}`;
    default: return '';
  }
}

/** 소수점이 생기면 둘째 자리까지만 보인다 (2로 나누는 규칙 등이 흔하다) */
function num(v) {
  const r = Math.round(v * 100) / 100;
  return String(r);
}

/**
 * 식 하나를 굴린다.
 * @returns {{ notation, detail, total, dice: [{sides,value}] }}
 * @throws 읽을 수 없거나 한도를 넘으면 Error (메시지를 그대로 보여준다)
 */
function roll(text) {
  const src = String(text || '').trim().slice(0, MAX_TEXT);
  if (!src) throw new Error('무엇을 굴릴지 적어 주세요');

  const tokens = tokenize(src);
  const count = tokens.filter((t) => t.t === 'dice').reduce((s, t) => s + t.n, 0);
  if (count === 0) throw new Error('주사위가 없습니다 (예: 1d20+3)');
  if (count > MAX_DICE) throw new Error(`한 번에 ${MAX_DICE}개까지 굴릴 수 있습니다`);

  const tree = parse(tokens);
  const dice = [];
  const total = evaluate(tree, dice);

  return {
    notation: show(tree),
    detail: showValues(tree),
    total: Math.round(total * 100) / 100,
    dice,
  };
}

/** 단추로 담은 것을 식으로 바꾼다: {d6:2, d20:1} → '2d6 + 1d20' */
function fromStage(stage) {
  const parts = [];
  for (const sides of SIDES) {
    const n = Number(stage?.[`d${sides}`] || 0);
    if (n > 0) parts.push(`${Math.min(n, MAX_DICE)}d${sides}`);
  }
  return parts.join('+');
}

/** 화면에 보여줄 한 줄 */
const line = (r) => `[다이스 판정]\n${r.notation} = ${r.detail} = ${num(r.total)}`;

module.exports = { roll, fromStage, line, SIDES, MAX_DICE };
