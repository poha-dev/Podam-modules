'use strict';
/**
 * 모듈 검사 틀.
 *
 * 코어(podam)를 끌어와 **이 저장소의 modules/ 를 얹은 채로** 서버를 띄운다.
 * 코어가 어디 있는지는 `PODAM_CORE` 로 알려 준다 (기본값은 옆 폴더의 `../podam`).
 *
 *   PODAM_CORE=../podam  node test/e2e.js
 *
 * 자기 모듈을 만드는 사람도 이 파일을 그대로 가져다 쓰면 된다.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const CORE = path.resolve(process.env.PODAM_CORE || path.join(__dirname, '..', '..', 'podam'));
if (!fs.existsSync(path.join(CORE, 'src', 'server.js'))) {
  console.error(`코어를 찾지 못했습니다: ${CORE}`);
  console.error('PODAM_CORE 환경변수로 podam 폴더를 알려 주세요.');
  process.exit(1);
}

// 임시 폴더를 쓰고, 이 저장소의 모듈을 싣게 한다. 끝나면 지운다.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'podam-mod-'));
process.env.DATA_DIR = TMP;
process.env.PORT = '0';
process.env.PODAM_MODULES_DIR = path.join(__dirname, '..', 'modules');

const { io } = require(path.join(CORE, 'node_modules', 'socket.io-client'));

let BASE = '';
let pass = 0;

const check = (label, fn) => {
  try { fn(); console.log(`  OK  ${label}`); pass++; }
  catch (e) { console.error(`  X   ${label}\n      ${e.message}`); process.exitCode = 1; }
};
const section = (n, title) => console.log(`\n[${n}] ${title}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(p, { method = 'GET', headers = {}, body, form } = {}) {
  const opts = { method, headers: { ...headers } };
  if (form) opts.body = form;
  else if (body !== undefined) {
    opts.headers['content-type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${p}`, opts);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

/** 소켓 하나를 열고 들어오는 것을 종류별로 쌓아 둔다. */
function connect(auth) {
  return new Promise((resolve, reject) => {
    const sock = io(BASE, { auth, transports: ['websocket'], reconnection: false });
    const received = [];
    const reactions = [];
    const verdicts = [];
    const stage = [];
    const boards = [];
    const rolls = [];
    const charFeed = [];
    const charMoves = [];
    sock.on('message', (m) => received.push(m));
    sock.on('reaction', (r) => reactions.push(r));
    sock.on('verdict:event', (e) => verdicts.push(e));
    sock.on('trpg:msg', (m) => stage.push(m));
    sock.on('trpg:board', (b) => boards.push(b));
    sock.on('trpg:roll', (r) => rolls.push(r));
    sock.on('chars:list', (c) => charFeed.push(c.chars));
    sock.on('chars:move', (m) => charMoves.push(m));
    sock.on('auth:error', (e) => reject(new Error(e.error)));
    sock.on('connect_error', reject);
    sock.on('auth:ok', (data) =>
      resolve({ sock, received, reactions, verdicts, stage, boards, rolls, charFeed, charMoves, hello: data }));
  });
}

const ask = (sock, event, payload) => new Promise((r) => sock.emit(event, payload, r));

/** 서버를 띄운다. 돌려주는 값으로 주소를 알 수 있다. */
async function start() {
  const { server } = require(path.join(CORE, 'src', 'server.js'));
  await new Promise((r) => (server.listening ? r() : server.once('listening', r)));
  BASE = `http://127.0.0.1:${server.address().port}`;
  return { server, BASE };
}

/** 끝맺음 — 센 것을 알리고 임시 폴더를 치운다. */
function done() {
  console.log(process.exitCode ? `\n실패 있음 — ${pass}개 확인` : `\n전부 통과 — ${pass}개 확인`);
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* 윈도에서 잠겨 있을 수 있다 */ }
  process.exit(process.exitCode || 0);
}

module.exports = {
  CORE, TMP, check, section, sleep, api, connect, ask, start, done,
  get BASE() { return BASE; },
};
