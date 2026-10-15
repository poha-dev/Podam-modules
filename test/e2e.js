/* 포담 공식 모듈 검사 — 코어를 끌어와 이 저장소의 모듈을 얹고 돌린다.
   실행: npm test        (코어 위치는 PODAM_CORE, 기본값 ../podam) */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./harness');
const { check, section, sleep, api, connect, ask } = H;

(async function main() {
  await H.start();
  const BASE = H.BASE;
  const TMP = H.TMP;

  // 모듈과 상관없는 「딴 방 사람」 하나 — 남의 파일을 못 받는지 볼 때 쓴다.
  const outRoom = await api('/api/rooms', { method: 'POST', body: { name: '딴 방', gmNickname: 'GM' } });
  const GM = { 'x-gm-token': outRoom.data.gmToken };
  const PGM = GM;                      // 모듈을 하나도 안 켜 둔 방의 GM
  const A = (await api(`/api/rooms/by-code/${outRoom.data.room.code}/join`,
    { method: 'POST', body: { nickname: '딴방사람' } })).data;

  section(1, '모듈 준비');

  // 모듈 방을 따로 만들어 아래 정답 판정 섹션에서 쓴다
  const vRoom = await api('/api/rooms', {
    method: 'POST', body: { name: '정답 판정 방', gmNickname: 'GM', modules: ['verdict'] },
  });
  const VGM = { 'x-gm-token': vRoom.data.gmToken };
  check('방을 만들 때 모듈을 켤 수 있다', () => assert.strictEqual(vRoom.status, 200));

  const vPeek = await api(`/api/rooms/by-code/${vRoom.data.room.code}`);
  check('방 밖에서는 어떤 모듈을 쓰는지 알 수 없다', () =>
    assert.strictEqual(vPeek.data.room.modules, undefined));
  const gmSeesMods = await api('/api/gm/room', { headers: VGM });
  check('GM에게는 보인다', () => assert.deepStrictEqual(gmSeesMods.data.room.modules, ['verdict']));

  const vJoinA = await api(`/api/rooms/by-code/${vRoom.data.room.code}/join`, { method: 'POST', body: { nickname: '수사관' } });
  const vJoinB = await api(`/api/rooms/by-code/${vRoom.data.room.code}/join`, { method: 'POST', body: { nickname: '구경꾼' } });
  const vA = await connect({ playerToken: vJoinA.data.token });
  const vB = await connect({ playerToken: vJoinB.data.token });
  const vGm = await connect({ gmToken: vRoom.data.gmToken });
  // 방 밖(코드만 아는 사람)에게는 안 알리고, 방에 들어온 사람에게는 '쓰는 법을 알아야 하는 모듈'만 알린다.
  check('방에 들어오면 쓰는 법이 필요한 모듈은 알려준다', () =>
    assert.deepStrictEqual(vA.hello.modules, ['verdict']));
  const vMe = await api('/api/me', { headers: { 'x-player-token': vJoinA.data.token } });
  check('내 정보에도 같은 목록이 온다', () => assert.deepStrictEqual(vMe.data.modules, ['verdict']));
  check('방 밖 조회에는 모듈이 실리지 않는다', () => assert.strictEqual(vPeek.data.room.modules, undefined));

  const guides = await api('/api/modules/guides');
  check('모듈이 자기 사용법을 들고 있다', () => {
    const g = guides.data.guides.find((x) => x.id === 'verdict');
    return assert.ok(g && g.gm.includes('정답:답변') && g.player.includes('정답 제출'));
  });

  const asPlayerMod = await api('/api/gm/verdict', { headers: { 'x-player-token': vJoinA.data.token } });
  check('플레이어 토큰으로는 모듈 API를 쓸 수 없다 (403)', () => assert.strictEqual(asPlayerMod.status, 403));
  const otherRoomMod = await api('/api/gm/verdict', { headers: GM });
  check('모듈을 안 켠 다른 방 GM도 막힌다 (404)', () => assert.strictEqual(otherRoomMod.status, 404));

  // 회귀 가드 — 모듈이 있어도 평범한 대화는 그대로 배달된다
  const beforeTalk = vA.received.length;
  await ask(vA.sock, 'player:send', { body: '평범한 이야기입니다' });
  await sleep(300);
  check('모듈이 켜져 있어도 대화는 그대로 배달된다', () =>
    assert.strictEqual(vA.received.length, beforeTalk + 1));


  section(2, '정답 판정 모듈');
  // 배역마다 「정답:답변」 표를 두고, 그 배역이 정답을 내면 짝지어진 답변이 나간다.
  const vRoles = (await api('/api/gm/roles', { method: 'POST', headers: VGM, body: { names: ['집사', '의사'] } })).data.roles;
  const butlerRole = vRoles.find((r) => r.name === '집사');
  const doctorRole = vRoles.find((r) => r.name === '의사');
  await api(`/api/gm/participants/${vJoinA.data.participant.id}/role`, {
    method: 'PUT', headers: VGM, body: { roleId: butlerRole.id },
  });
  await api(`/api/gm/participants/${vJoinB.data.participant.id}/role`, {
    method: 'PUT', headers: VGM, body: { roleId: doctorRole.id },
  });

  const vTable = [
    '[집사]',
    '타임루프:짐작 가는 것은 없습니다.',
    '명예:마왕님의 명언입니다.',
    '',
    '[의사]',
    '타임루프:의사로서 말씀드리면 불가능합니다.',
    '',
    '[공용]',
    '저택:낡았지만 관리는 잘 되어 있습니다.',
  ].join('\n');

  const vImported = await api('/api/gm/verdict/import', { method: 'POST', headers: VGM, body: { text: vTable } });
  check('정답표를 통째로 불러온다', () => assert.strictEqual(vImported.data.added, 4));
  check('배역별로 나뉘어 들어간다', () => {
    const byName = Object.fromEntries(vImported.data.tables.map((t) => [t.name, t.count]));
    return assert.deepStrictEqual(byName, { 공용: 1, 집사: 2, 의사: 1 });
  });

  const vdUnknown = await api('/api/gm/verdict/import', {
    method: 'POST', headers: VGM, body: { text: '[없는배역]\n가:나', mode: 'merge' },
  });
  check('없는 배역 이름은 공용으로 넣고 알려준다', () =>
    assert.deepStrictEqual(vdUnknown.data.unknownRoles, ['없는배역']));

  // 제출 — 같은 말이라도 배역에 따라 다른 답이 나온다
  const beforeA = vA.received.length;
  const beforeB = vB.received.length;
  const vdAskA = await ask(vA.sock, 'mod:verdict:ask', { text: '타임 루프!' });
  await sleep(400);
  check('정답을 내면 답변이 온다', () => assert.ok(vdAskA.ok && vdAskA.matched));
  check('내 배역의 답변이 온다', () =>
    assert.ok(vA.received.slice(beforeA).some((m) => m.kind === 'vans' && m.body === '짐작 가는 것은 없습니다.')));
  check('띄어쓰기와 구두점은 무시한다', () => assert.strictEqual(vdAskA.reply, '짐작 가는 것은 없습니다.'));
  check('무엇을 냈는지도 대화에 남는다', () =>
    assert.ok(vA.received.slice(beforeA).some((m) => m.kind === 'vask' && m.body === '타임 루프!')));
  check('다른 플레이어에게는 가지 않는다', () => assert.strictEqual(vB.received.length, beforeB));

  const vdAskB = await ask(vB.sock, 'mod:verdict:ask', { text: '타임루프' });
  await sleep(300);
  check('같은 정답이라도 배역이 다르면 답이 다르다', () =>
    assert.strictEqual(vdAskB.reply, '의사로서 말씀드리면 불가능합니다.'));

  const vdAskCommon = await ask(vA.sock, 'mod:verdict:ask', { text: '저택' });
  check('공용 표는 모든 배역에게 통한다', () => assert.strictEqual(vdAskCommon.reply, '낡았지만 관리는 잘 되어 있습니다.'));

  const vdAskAgain = await ask(vA.sock, 'mod:verdict:ask', { text: '타임루프' });
  check('같은 정답을 다시 내도 답이 온다', () => assert.ok(vdAskAgain.matched));

  // 문구를 비워두면 못 찾았을 때 아무 말도 하지 않는다 (빈 자리를 만들지 않게)
  const beforeMiss = vA.received.length;
  const vdMiss = await ask(vA.sock, 'mod:verdict:ask', { text: '용의자는 고양이' });
  await sleep(300);
  check('없는 정답은 못 찾았다고 답한다', () => assert.ok(vdMiss.ok && !vdMiss.matched));
  check('문구가 비어 있으면 아무 말도 하지 않는다', () =>
    assert.ok(!vA.received.slice(beforeMiss).some((m) => m.sender === 'system')));

  await api('/api/gm/verdict/settings', {
    method: 'PUT', headers: VGM, body: { missText: '아직 알아낸 것이 없습니다.', npcName: '집사 노인' },
  });
  const beforeNotice = vA.received.length;
  await ask(vA.sock, 'mod:verdict:ask', { text: '또 없는 말' });
  await sleep(300);
  check('문구를 적어두면 그 문구로 알려준다', () =>
    assert.ok(vA.received.slice(beforeNotice).some((m) => m.sender === 'system' && m.body === '아직 알아낸 것이 없습니다.')));

  // GM 알림 범위 — 기본은 '맞혔을 때만'이라 헛짚은 문답은 GM을 울리지 않는다
  const gmBeforeMiss = vGm.received.length;
  await ask(vA.sock, 'mod:verdict:ask', { text: '그냥 헛짚기' });
  await sleep(350);
  check('헛짚은 문답은 GM 화면에 뜨지 않는다', () => assert.strictEqual(vGm.received.length, gmBeforeMiss));

  const gmBeforeHit = vGm.received.length;
  await ask(vA.sock, 'mod:verdict:ask', { text: '명예' });
  await sleep(350);
  check('맞혔을 때는 GM 화면에도 뜬다', () => assert.ok(vGm.received.length > gmBeforeHit));

  await api('/api/gm/verdict/settings', { method: 'PUT', headers: VGM, body: { gmFeed: 'all' } });
  const gmBeforeAll = vGm.received.length;
  await ask(vA.sock, 'mod:verdict:ask', { text: '또 헛짚기' });
  await sleep(350);
  check('전부 알림으로 두면 헛짚은 것도 보인다', () => assert.ok(vGm.received.length > gmBeforeAll));

  await api('/api/gm/verdict/settings', { method: 'PUT', headers: VGM, body: { gmFeed: 'none' } });
  const gmBeforeNone = vGm.received.length;
  const quietHit = await ask(vA.sock, 'mod:verdict:ask', { text: '명예' });
  await sleep(350);
  check('알림 없음으로 두면 맞혀도 GM 화면이 조용하다', () =>
    assert.strictEqual(vGm.received.length, gmBeforeNone));
  check('그래도 플레이어에게는 답이 간다', () => assert.ok(quietHit.matched));
  const quietLog = await api('/api/gm/verdict', { headers: VGM });
  check('알리지 않아도 기록에는 남는다', () =>
    assert.ok(quietLog.data.log.some((l) => l.asked === '명예')));
  await api('/api/gm/verdict/settings', { method: 'PUT', headers: VGM, body: { gmFeed: 'hit' } });

  const beforeNpc = vA.received.length;
  await ask(vA.sock, 'mod:verdict:ask', { text: '명예' });
  await sleep(300);
  check('정한 이름으로 답한다', () =>
    assert.ok(vA.received.slice(beforeNpc).some((m) => m.kind === 'vans' && m.senderName === '집사 노인')));

  await sleep(150);
  check('GM에게 주고받은 내용이 전달된다', () =>
    assert.ok(vGm.verdicts.some((e) => e.type === 'hit' && e.nickname === '수사관')));
  const vSnap = await api('/api/gm/verdict', { headers: VGM });
  check('GM 화면에 기록이 쌓인다', () => assert.ok(vSnap.data.log.length > 0));

  // 한 배역의 표만 갈아끼우기
  const vdReplaced = await api('/api/gm/verdict/table', {
    method: 'PUT', headers: VGM, body: { roleId: butlerRole.id, text: '열쇠:책상 서랍에 있었습니다.' },
  });
  check('한 배역의 표만 바꿀 수 있다', () => assert.strictEqual(vdReplaced.data.count, 1));
  const vdGone = await ask(vA.sock, 'mod:verdict:ask', { text: '명예' });
  check('바꾸면 예전 정답은 사라진다', () => assert.ok(!vdGone.matched));
  const vdNowKey = await ask(vA.sock, 'mod:verdict:ask', { text: '열쇠' });
  check('새 정답이 통한다', () => assert.strictEqual(vdNowKey.reply, '책상 서랍에 있었습니다.'));

  // 내보내기 — 그대로 다시 불러올 수 있어야 한다
  const vExport = await fetch(`${BASE}/api/gm/verdict/export?gm=${encodeURIComponent(vRoom.data.gmToken)}`);
  const vExportText = await vExport.text();
  check('정답표를 글로 내보낸다', () => assert.ok(vExportText.includes('[집사]') && vExportText.includes('열쇠:책상 서랍에 있었습니다.')));
  check('내보낸 글에 대화 기록은 없다', () => assert.ok(!vExportText.includes('용의자는 고양이')));

  const vPlayerAsk = await api('/api/gm/verdict', { headers: { 'x-player-token': vJoinA.data.token } });
  check('플레이어는 정답표를 볼 수 없다 (403)', () => assert.strictEqual(vPlayerAsk.status, 403));

  // 모듈을 끄면 제출 자체가 막힌다
  await api('/api/gm/modules', { method: 'PUT', headers: VGM, body: { id: 'verdict', on: false } });
  const askWhenOff = await ask(vA.sock, 'mod:verdict:ask', { text: '열쇠' });
  check('모듈을 끄면 제출이 막힌다', () => assert.ok(askWhenOff.error));
  await api('/api/gm/modules', { method: 'PUT', headers: VGM, body: { id: 'verdict', on: true } });

  // 룸 셋팅으로 옮기면 배역 이름을 보고 다시 붙는다
  const vBundleRes = await fetch(`${BASE}/api/gm/bundle?gm=${encodeURIComponent(vRoom.data.gmToken)}`);
  const vBundle = Buffer.from(await vBundleRes.arrayBuffer());
  check('룸 셋팅에 정답표가 담긴다', () => assert.ok(vBundle.toString('utf8').includes('열쇠')));
  check('주고받은 기록은 담기지 않는다', () => assert.ok(!vBundle.toString('utf8').includes('용의자는 고양이')));

  const vNewRoom = await api('/api/rooms', { method: 'POST', body: { name: '정답 이어가기', gmNickname: 'GM' } });
  const NVGM = { 'x-gm-token': vNewRoom.data.gmToken };
  const vImpFd = new FormData();
  vImpFd.append('bundle', new Blob([vBundle], { type: 'application/zip' }), 'pack.zip');
  const vImp = await api('/api/gm/bundle/import', { method: 'POST', headers: NVGM, form: vImpFd });
  check('룸 셋팅을 가져온다', () => assert.strictEqual(vImp.status, 200));
  const vdNewSnap = await api('/api/gm/verdict', { headers: NVGM });
  check('배역 이름을 보고 정답표가 제자리에 붙는다', () => {
    const butler = vdNewSnap.data.tables.find((t) => t.name === '집사');
    return assert.ok(butler && butler.text.includes('열쇠:책상 서랍에 있었습니다.'));
  });

  [vA, vB, vGm].forEach((c) => c.sock.disconnect());

  section(3, 'TRPG 공용 무대');
  // 이 앱에서 처음으로 '모두가 같은 것을 보는' 기능이다.
  // 공용으로 내놓은 것만 공용이고, 1:1 자료는 여전히 새면 안 된다 — 그 경계를 집중해서 본다.
  // 아주 작은 PNG 한 장 (배경 그림 노릇을 한다)
  const tinyPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64');

  // (1) 모듈이 꺼진 방
  const tOff = await api('/api/gm/trpg', { headers: PGM });
  check('모듈이 꺼진 방에서는 TRPG 조회가 막힌다 (404)', () => assert.strictEqual(tOff.status, 404));

  // (2) 켠 방 만들기
  const tRoom = await api('/api/rooms', {
    method: 'POST', body: { name: 'TRPG 방', gmNickname: '진행자', modules: ['trpg'] },
  });
  const TGM = { 'x-gm-token': tRoom.data.gmToken };
  const tCode = tRoom.data.room.code;
  const tA = (await api(`/api/rooms/by-code/${tCode}/join`, { method: 'POST', body: { nickname: '사냥꾼' } })).data;
  const tB = (await api(`/api/rooms/by-code/${tCode}/join`, { method: 'POST', body: { nickname: '도적' } })).data;
  const tC = (await api(`/api/rooms/by-code/${tCode}/join`, { method: 'POST', body: { nickname: '나갈사람' } })).data;
  const ta = await connect({ playerToken: tA.token });
  const tb = await connect({ playerToken: tB.token });
  const tc = await connect({ playerToken: tC.token });
  const tgm = await connect({ gmToken: tRoom.data.gmToken });

  // (3) 한 사람이 말하면 방에 있는 모두가 본다
  const tSaid = await ask(ta.sock, 'mod:trpg:say', { text: '모두 안녕하세요' });
  await sleep(250);
  check('공용 발언이 본인에게 온다', () => assert.strictEqual(ta.stage.length, 1));
  check('공용 발언이 다른 플레이어에게도 간다', () =>
    assert.strictEqual(tb.stage.at(-1).body, '모두 안녕하세요'));
  check('공용 발언이 GM에게도 간다', () => assert.strictEqual(tgm.stage.length, 1));
  check('이름이 함께 간다', () => assert.strictEqual(tb.stage.at(-1).nickname, '사냥꾼'));

  // (4) 1:1 대화는 조금도 건드리지 않는다 — 이게 이 모듈의 생명줄이다
  check('공용 발언은 1:1 대화에 섞이지 않는다', () =>
    assert.ok(ta.received.length === 0 && tb.received.length === 0 && tgm.received.length === 0));

  // (5) 들어올 때 한 벌 받기 (재접속도 이 길이다)
  const tHello = await ask(tb.sock, 'mod:trpg:hello', {});
  check('다시 들어와도 지난 기록을 받는다', () => assert.strictEqual(tHello.messages.length, 1));
  check('플레이어에게는 무대 자료 목록을 주지 않는다', () => assert.strictEqual(tHello.assets, undefined));
  const tHelloGm = await ask(tgm.sock, 'mod:trpg:hello', {});
  check('GM은 무대 자료 목록을 받는다', () => assert.ok(Array.isArray(tHelloGm.assets)));

  // (6) 무대를 바꾸는 것은 GM만
  const badBoard = await ask(ta.sock, 'mod:trpg:board', { bgFileId: null });
  check('플레이어는 무대를 못 바꾼다', () => assert.ok(badBoard.error));

  // (7) GM이 배경을 올리고 띄우면 모두가 같은 그림을 본다
  const bgForm = new FormData();
  bgForm.append('kind', 'bg');
  bgForm.append('files', new Blob([tinyPng], { type: 'image/png' }), '숲.png');
  const bgUp = await api('/api/gm/trpg/assets/upload', { method: 'POST', headers: TGM, form: bgForm });
  check('무대 그림을 올릴 수 있다', () => assert.strictEqual(bgUp.status, 200));
  const bgFileId = bgUp.data.assets[0].fileId;

  const setBg = await ask(tgm.sock, 'mod:trpg:board', { bgFileId });
  await sleep(250);
  check('배경을 띄우면 모두에게 같은 그림이 간다', () =>
    assert.ok(ta.boards.at(-1).bgFileId === bgFileId && tb.boards.at(-1).bgFileId === bgFileId));
  check('무대 상태가 저장된다', () => assert.strictEqual(setBg.board.bgFileId, bgFileId));

  // (8) 공용으로 내놓은 파일은 방 사람 누구나 받을 수 있다
  const bgByA = await fetch(`${BASE}/f/${bgFileId}?t=${encodeURIComponent(tA.token)}`);
  check('무대 그림은 플레이어도 받을 수 있다', () => assert.strictEqual(bgByA.status, 200));
  const bgByOther = await fetch(`${BASE}/f/${bgFileId}?t=${encodeURIComponent(A.token)}`);
  check('다른 방 사람은 못 받는다 (404)', () => assert.strictEqual(bgByOther.status, 404));

  // (9) 공용 대화에 올린 파일도 모두가 받는다
  const shareForm = new FormData();
  shareForm.append('files', new Blob([Buffer.from('%PDF-1.4 단서')], { type: 'application/pdf' }), '단서.pdf');
  const tShared = await api('/api/trpg/upload', {
    method: 'POST', headers: { 'x-player-token': tA.token }, form: shareForm,
  });
  await sleep(250);
  check('플레이어도 공용 대화에 파일을 올릴 수 있다', () => assert.strictEqual(tShared.status, 200));
  const sharedFileId = tb.stage.at(-1).file.id;
  const sharedByB = await fetch(`${BASE}/f/${sharedFileId}?t=${encodeURIComponent(tB.token)}`);
  check('올린 사람이 아니어도 공용 첨부는 받을 수 있다', () => assert.strictEqual(sharedByB.status, 200));

  // (10) 1:1 자료는 여전히 새지 않는다 (권한이 넓어지지 않았는지)
  const privForm = new FormData();
  privForm.append('files', new Blob([Buffer.from('%PDF-1.4 비밀')], { type: 'application/pdf' }), '비밀.pdf');
  const privUp = await api('/api/gm/library', { method: 'POST', headers: TGM, form: privForm });
  const privId = privUp.data.files[0].id;
  await api('/api/gm/send', { method: 'POST', headers: TGM, body: { targets: [tA.participant.id], fileId: privId } });
  await sleep(200);
  const privByA = await fetch(`${BASE}/f/${privId}?t=${encodeURIComponent(tA.token)}`);
  const privByB = await fetch(`${BASE}/f/${privId}?t=${encodeURIComponent(tB.token)}`);
  check('받은 사람만 1:1 자료를 받는다', () => assert.strictEqual(privByA.status, 200));
  check('공용 무대가 켜져 있어도 1:1 자료는 안 샌다 (404)', () => assert.strictEqual(privByB.status, 404));

  // (11) 내보낸 사람에게는 공용 발언도 가지 않는다
  await api('/api/gm/participants/' + tC.participant.id, { method: 'DELETE', headers: TGM });
  await sleep(250);
  const kickedSeen = tc.stage.length;
  await ask(tgm.sock, 'mod:trpg:say', { text: '쫓겨난 사람은 못 본다' });
  await sleep(250);
  check('내보낸 사람에게는 공용 발언이 가지 않는다', () => assert.strictEqual(tc.stage.length, kickedSeen));

  // (12) 지우기
  const delByOther = await ask(tb.sock, 'mod:trpg:del', { id: tSaid.message.id });
  check('남이 쓴 줄은 못 지운다', () => assert.ok(delByOther.error));
  const delByMine = await ask(ta.sock, 'mod:trpg:del', { id: tSaid.message.id });
  await sleep(200);
  check('내가 쓴 줄은 지울 수 있다', () => assert.ok(delByMine.ok));
  const tAfterDel = await ask(tb.sock, 'mod:trpg:hello', {});
  check('지운 줄은 기록에서도 빠진다', () =>
    assert.ok(!tAfterDel.messages.some((m) => m.id === tSaid.message.id)));
  const goneFile = await fetch(`${BASE}/f/${sharedFileId}?t=${encodeURIComponent(tB.token)}`);
  check('지우기 전 첨부는 그대로 열린다', () => assert.strictEqual(goneFile.status, 200));

  // (13) 룸 셋팅에 무대 준비물이 실린다 (진행 기록은 빠진다)
  const tBundle = await fetch(`${BASE}/api/gm/bundle?gm=${encodeURIComponent(tRoom.data.gmToken)}`);
  const tBuf = Buffer.from(await tBundle.arrayBuffer());
  const tText = tBuf.toString('utf8');
  check('룸 셋팅에 무대 자료가 담긴다', () => assert.ok(tText.includes('"trpg"') && tText.includes('"assets"')));
  check('룸 셋팅에 공용 대화는 담기지 않는다', () => assert.ok(!tText.includes('모두 안녕하세요')));

  const tNew = await api('/api/rooms', { method: 'POST', body: { name: '복원한 TRPG 방', gmNickname: 'GM' } });
  const TNGM = { 'x-gm-token': tNew.data.gmToken };
  const tImportForm = new FormData();
  tImportForm.append('bundle', new Blob([tBuf], { type: 'application/zip' }), 'trpg.zip');
  await api('/api/gm/bundle/import', { method: 'POST', headers: TNGM, form: tImportForm });
  const tNewSnap = await api('/api/gm/trpg', { headers: TNGM });
  check('가져온 방에도 무대 자료가 생긴다', () => assert.strictEqual(tNewSnap.data.assets.length, 1));
  check('무대 그림이 새 방의 파일로 바뀐다', () => {
    const fresh = tNewSnap.data.assets[0].fileId;
    return assert.ok(fresh && fresh !== bgFileId && tNewSnap.data.board.bgFileId === fresh);
  });
  check('가져오자마자 음악이 흐르지 않는다', () => assert.strictEqual(tNewSnap.data.board.bgmPlaying, false));

  // (14) 모듈을 끄면 공용 자료도 다시 잠긴다
  await api('/api/gm/modules', { method: 'PUT', headers: TGM, body: { id: 'trpg', on: false } });
  const lockedAgain = await fetch(`${BASE}/f/${bgFileId}?t=${encodeURIComponent(tA.token)}`);
  check('모듈을 끄면 무대 그림도 다시 잠긴다 (404)', () => assert.strictEqual(lockedAgain.status, 404));
  const sayOff = await ask(ta.sock, 'mod:trpg:say', { text: '꺼졌는데 말하기' });
  check('모듈을 끄면 공용 발언도 막힌다', () => assert.ok(sayOff.error));

  [ta, tb, tc, tgm].forEach((c) => c.sock.disconnect());

  section(4, 'TRPG 주사위');
  // 눈은 서버가 정한다. 「모두가 같은 숫자를 본다」와 「비밀 굴림이 새지 않는다」가 핵심이다.
  const dRoom = await api('/api/rooms', {
    method: 'POST', body: { name: '주사위 방', gmNickname: '진행자', modules: ['trpg'] },
  });
  const DGM = { 'x-gm-token': dRoom.data.gmToken };
  const dCode = dRoom.data.room.code;
  const dA = (await api(`/api/rooms/by-code/${dCode}/join`, { method: 'POST', body: { nickname: '전사' } })).data;
  const dB = (await api(`/api/rooms/by-code/${dCode}/join`, { method: 'POST', body: { nickname: '도둑' } })).data;
  const da = await connect({ playerToken: dA.token });
  const db2 = await connect({ playerToken: dB.token });
  const dgm = await connect({ gmToken: dRoom.data.gmToken });

  // (1) 식 읽기
  const dr1 = await ask(da.sock, 'mod:trpg:roll', { notation: '1d4 + 3d6' });
  await sleep(250);
  check('식을 읽고 굴린다', () => assert.strictEqual(dr1.roll.notation, '1d4 + 3d6'));
  check('주사위 개수가 맞는다', () => assert.strictEqual(dr1.roll.dice.length, 4));
  check('눈이 면 수 안에 들어온다', () => assert.ok(dr1.roll.dice.every((d) => d.value >= 1 && d.value <= d.sides)));
  check('합이 맞는다', () =>
    assert.strictEqual(dr1.roll.total, dr1.roll.dice.reduce((s2, d) => s2 + d.value, 0)));
  check('보여줄 식이 「눈 = 합」 꼴이다', () =>
    assert.ok(/^\d+ \+ \(\d+ \+ \d+ \+ \d+\)$/.test(dr1.roll.detail)));

  // (2) 모두가 같은 숫자를 본다 ← 이 기능의 핵심
  check('굴림이 다른 플레이어에게도 간다', () => assert.strictEqual(db2.rolls.length, 1));
  check('GM에게도 간다', () => assert.strictEqual(dgm.rolls.length, 1));
  check('모두가 같은 눈을 본다', () =>
    assert.deepStrictEqual(db2.rolls.at(-1).dice, dr1.roll.dice));
  check('누가 굴렸는지 함께 간다', () => assert.strictEqual(db2.rolls.at(-1).nickname, '전사'));

  // (3) 결과는 굴린 사람의 말풍선으로 남는다 (굴러가는 걸 다 본 뒤 화면이 띄운다)
  const dHist = await ask(db2.sock, 'mod:trpg:hello', {});
  const diceLine = dHist.messages.filter((m) => m.kind === 'dice').at(-1);
  check('공용 대화에 판정 줄이 남는다', () => assert.ok(diceLine && diceLine.body.startsWith('[다이스 판정]')));
  check('판정 줄에 굴린 사람 이름이 있다', () => assert.strictEqual(diceLine.nickname, '전사'));
  check('굴리는 동안 미리 새지 않는다', () => assert.strictEqual(db2.stage.length, 0));

  // (4) 사칙연산
  const dr2 = await ask(da.sock, 'mod:trpg:roll', { notation: '(1d6+2)*3' });
  check('괄호와 곱셈이 된다', () => assert.strictEqual(dr2.roll.notation, '(1d6 + 2) * 3'));
  check('곱셈 결과가 맞는다', () =>
    assert.strictEqual(dr2.roll.total, (dr2.roll.dice[0].value + 2) * 3));

  // (5) 단추로 담은 것도 같은 길
  const dr3 = await ask(da.sock, 'mod:trpg:roll', { stage: { d6: 2, d20: 1 } });
  check('담은 주사위도 굴러간다', () => assert.strictEqual(dr3.roll.dice.length, 3));
  check('담은 순서대로 식이 만들어진다', () => assert.strictEqual(dr3.roll.notation, '2d6 + 1d20'));

  // (6) 이상한 식은 막는다
  for (const bad of ['1d7', '99d20', 'abc', '1d6/0', '((1d6)']) {
    const r = await ask(da.sock, 'mod:trpg:roll', { notation: bad });
    check(`이상한 식은 막는다 — ${bad}`, () => assert.ok(r.error));
  }

  // (7) 비밀 굴림 — GM만
  const seenBefore = da.rolls.length;
  const stageBefore = da.stage.length;
  const dSecret = await ask(dgm.sock, 'mod:trpg:roll', { notation: '1d20', secret: true });
  await sleep(250);
  check('GM은 비밀로 굴릴 수 있다', () => assert.ok(dSecret.roll.secret));
  check('비밀 굴림은 플레이어에게 가지 않는다', () => assert.strictEqual(da.rolls.length, seenBefore));
  check('비밀 굴림은 공용 대화에도 남지 않는다', () => assert.strictEqual(da.stage.length, stageBefore));
  const afterSecret = await ask(da.sock, 'mod:trpg:hello', {});
  check('플레이어 기록에도 비밀 굴림이 없다', () =>
    assert.ok(!afterSecret.rolls.some((r) => r.id === dSecret.roll.id)));
  const gmRolls = await api('/api/gm/trpg/rolls', { headers: DGM });
  check('GM 기록에는 비밀 굴림이 남는다', () =>
    assert.ok(gmRolls.data.rolls.some((r) => r.id === dSecret.roll.id && r.secret)));

  // (8) 플레이어가 비밀이라 우겨도 안 통한다
  const dFake = await ask(da.sock, 'mod:trpg:roll', { notation: '1d6', secret: true });
  await sleep(250);
  check('플레이어의 비밀 굴림은 무시된다', () => assert.strictEqual(dFake.roll.secret, false));
  check('그 굴림은 모두에게 간다', () => assert.ok(db2.rolls.some((r) => r.id === dFake.roll.id)));

  // (9) 던지는 세기는 0~1로 잘라 둔다 (화면 연출용)
  const rPow = await ask(da.sock, 'mod:trpg:roll', { notation: '1d6', strength: 5 });
  check('세기는 0~1 안으로 들어온다', () => assert.strictEqual(rPow.roll.strength, 1));
  const rPow2 = await ask(da.sock, 'mod:trpg:roll', { notation: '1d6', strength: 'x' });
  check('세기가 이상하면 비워 둔다', () => assert.strictEqual(rPow2.roll.strength, null));

  // (10) 눈이 한쪽으로 쏠리지 않는지 대충 확인
  const dSeen = new Set();
  for (let i = 0; i < 40; i++) {
    const r = await ask(da.sock, 'mod:trpg:roll', { notation: '5d6' });
    for (const d of r.roll.dice) dSeen.add(d.value);
  }
  check('d6의 눈 1~6이 모두 나온다', () => assert.strictEqual(dSeen.size, 6));

  // (11) 모듈을 끄면 굴릴 수 없다
  await api('/api/gm/modules', { method: 'PUT', headers: DGM, body: { id: 'trpg', on: false } });
  const dOff = await ask(da.sock, 'mod:trpg:roll', { notation: '1d6' });
  check('모듈을 끄면 주사위도 막힌다', () => assert.ok(dOff.error));

  [da, db2, dgm].forEach((c) => c.sock.disconnect());

  section(5, 'TRPG 캐릭터 카드');
  // 「모두 보기 · 내 것만 고치기」와 「숨긴 카드는 아예 안 보인다」가 핵심이다.
  const cRoom = await api('/api/rooms', {
    method: 'POST', body: { name: '캐릭터 방', gmNickname: '진행자', modules: ['trpg', 'trpg-chars'] },
  });
  const CGM = { 'x-gm-token': cRoom.data.gmToken };
  const cCode = cRoom.data.room.code;
  const cA = (await api(`/api/rooms/by-code/${cCode}/join`, { method: 'POST', body: { nickname: '전사' } })).data;
  const cB = (await api(`/api/rooms/by-code/${cCode}/join`, { method: 'POST', body: { nickname: '도적' } })).data;
  const ca = await connect({ playerToken: cA.token });
  const cb = await connect({ playerToken: cB.token });
  const cgm = await connect({ gmToken: cRoom.data.gmToken });

  // (1) 방 기본 틀
  const cTpl = await ask(cgm.sock, 'mod:trpg-chars:tpl', {
    rows: [{ label: '체력', cur: 20, max: 20 }, { label: '기력', cur: 3, max: 3 }],
  });
  await sleep(200);
  check('GM이 기본 항목을 정한다', () => assert.strictEqual(cTpl.statTemplate.length, 2));
  const tplByPlayer = await ask(ca.sock, 'mod:trpg-chars:tpl', { rows: [] });
  check('플레이어는 기본 항목을 못 바꾼다', () => assert.ok(tplByPlayer.error));

  // (2) 만들면 기본 틀을 물려받는다
  const mkA = await ask(ca.sock, 'mod:trpg-chars:save', { op: 'save', char: { name: '전사의 카드' } });
  await sleep(250);
  check('플레이어가 자기 카드를 만든다', () => assert.strictEqual(mkA.char.name, '전사의 카드'));
  check('기본 항목을 물려받는다', () =>
    assert.deepStrictEqual(mkA.char.stats.map((x) => x.label), ['체력', '기력']));
  check('주인이 자기로 잡힌다', () => assert.strictEqual(mkA.char.ownerId, cA.participant.id));
  check('다른 사람에게도 카드가 간다', () =>
    assert.ok(cb.charFeed.at(-1).some((x) => x.id === mkA.char.id)));

  // (3) 내 카드만 고친다
  const editMine = await ask(ca.sock, 'mod:trpg-chars:save', {
    op: 'save', char: { id: mkA.char.id, stats: [{ label: '체력', cur: 12, max: 20 }] },
  });
  check('내 카드는 고칠 수 있다', () => assert.strictEqual(editMine.char.stats[0].cur, 12));
  const editOther = await ask(cb.sock, 'mod:trpg-chars:save', {
    op: 'save', char: { id: mkA.char.id, name: '뺏은 카드' },
  });
  check('남의 카드는 못 고친다', () => assert.ok(editOther.error));
  const delOther = await ask(cb.sock, 'mod:trpg-chars:save', { op: 'del', id: mkA.char.id });
  check('남의 카드는 못 지운다', () => assert.ok(delOther.error));
  const byGm = await ask(cgm.sock, 'mod:trpg-chars:save', {
    op: 'save', char: { id: mkA.char.id, note: 'GM이 적은 메모' },
  });
  check('GM은 남의 카드도 고친다', () => assert.strictEqual(byGm.char.note, 'GM이 적은 메모'));

  // (4) 숨김은 GM만
  const sneaky = await ask(ca.sock, 'mod:trpg-chars:save', {
    op: 'save', char: { id: mkA.char.id, hidden: true },
  });
  check('플레이어가 숨김을 켜도 무시된다', () => assert.strictEqual(sneaky.char.hidden, false));

  const cNpc = await ask(cgm.sock, 'mod:trpg-chars:save', {
    op: 'save', char: { name: '숨은 적', hidden: true },
  });
  await sleep(250);
  check('GM은 숨긴 카드를 만든다', () => assert.strictEqual(cNpc.char.hidden, true));
  const helloA = await ask(ca.sock, 'mod:trpg-chars:hello', {});
  check('숨긴 카드는 플레이어 목록에 없다', () =>
    assert.ok(!helloA.chars.some((x) => x.id === cNpc.char.id)));
  check('숨긴 카드는 플레이어 방송에도 없다', () =>
    assert.ok(!ca.charFeed.at(-1).some((x) => x.id === cNpc.char.id)));
  const helloGm = await ask(cgm.sock, 'mod:trpg-chars:hello', {});
  check('GM 목록에는 있다', () => assert.ok(helloGm.chars.some((x) => x.id === cNpc.char.id)));

  // (5) 그림 — 방 사람은 보고, 숨긴 카드 그림은 못 본다
  const pngBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64');
  const imgForm = new FormData();
  imgForm.append('files', new Blob([pngBytes], { type: 'image/png' }), '얼굴.png');
  const cUp = await api(`/api/trpg-chars/${mkA.char.id}/image`, {
    method: 'POST', headers: { 'x-player-token': cA.token }, form: imgForm,
  });
  check('자기 카드에 그림을 올린다', () => assert.strictEqual(cUp.status, 200));
  const faceId = cUp.data.char.imageFileId;
  const faceByB = await fetch(`${BASE}/f/${faceId}?t=${encodeURIComponent(cB.token)}`);
  check('카드 그림은 방 사람 누구나 본다', () => assert.strictEqual(faceByB.status, 200));

  const npcForm = new FormData();
  npcForm.append('files', new Blob([pngBytes], { type: 'image/png' }), '적.png');
  const npcUp = await api(`/api/trpg-chars/${cNpc.char.id}/image`, {
    method: 'POST', headers: CGM, form: npcForm,
  });
  const npcFace = npcUp.data.char.imageFileId;
  const npcByA = await fetch(`${BASE}/f/${npcFace}?t=${encodeURIComponent(cA.token)}`);
  check('숨긴 카드의 그림은 플레이어가 못 받는다 (404)', () => assert.strictEqual(npcByA.status, 404));

  const otherForm = new FormData();
  otherForm.append('files', new Blob([pngBytes], { type: 'image/png' }), '몰래.png');
  const otherUp = await api(`/api/trpg-chars/${mkA.char.id}/image`, {
    method: 'POST', headers: { 'x-player-token': cB.token }, form: otherForm,
  });
  check('남의 카드에는 그림을 못 올린다 (403)', () => assert.strictEqual(otherUp.status, 403));

  const pdfForm = new FormData();
  pdfForm.append('files', new Blob([Buffer.from('%PDF-1.4')], { type: 'application/pdf' }), '문서.pdf');
  const pdfUp = await api(`/api/trpg-chars/${mkA.char.id}/image`, {
    method: 'POST', headers: { 'x-player-token': cA.token }, form: pdfForm,
  });
  check('그림이 아니면 막는다 (415)', () => assert.strictEqual(pdfUp.status, 415));

  // (6) 한도와 다듬기
  const longName = await ask(ca.sock, 'mod:trpg-chars:save', {
    op: 'save',
    char: {
      id: mkA.char.id,
      name: '가'.repeat(40),
      stats: Array.from({ length: 20 }, (_, i) => ({ label: `항목${i}`, cur: i, max: 99 })),
      status: Array.from({ length: 20 }, (_, i) => `상태${i}`),
    },
  });
  check('이름은 20자로 자른다', () => assert.strictEqual(longName.char.name.length, 20));
  check('항목은 12줄로 자른다', () => assert.strictEqual(longName.char.stats.length, 12));
  check('상태이상은 12개로 자른다', () => assert.strictEqual(longName.char.status.length, 12));

  await ask(ca.sock, 'mod:trpg-chars:save', { op: 'save', char: { name: '둘째' } });
  await ask(ca.sock, 'mod:trpg-chars:save', { op: 'save', char: { name: '셋째' } });
  const fourth = await ask(ca.sock, 'mod:trpg-chars:save', { op: 'save', char: { name: '넷째' } });
  check('한 사람은 3장까지', () => assert.ok(fourth.error));

  // (6-2) 무대 위 토큰 — 누구나 옮길 수 있다
  const putOnStage = await ask(ca.sock, 'mod:trpg-chars:place', { id: mkA.char.id, on: true, x: 0.25, y: 0.75 });
  await sleep(250);
  check('카드를 무대에 올린다', () => assert.ok(putOnStage.ok && putOnStage.onStage));
  check('올린 자리가 그대로 온다', () =>
    assert.ok(Math.abs(putOnStage.x - 0.25) < 1e-6 && Math.abs(putOnStage.y - 0.75) < 1e-6));
  check('다른 사람에게도 자리가 간다', () => {
    const last = cb.charMoves.at(-1);
    return assert.ok(last && last.id === mkA.char.id && Math.abs(last.x - 0.25) < 1e-6);
  });

  const movedByB = await ask(cb.sock, 'mod:trpg-chars:place', { id: mkA.char.id, x: 0.9, y: 0.1 });
  check('남의 카드라도 토큰은 옮길 수 있다', () => assert.ok(movedByB.ok));

  const wild = await ask(ca.sock, 'mod:trpg-chars:place', { id: mkA.char.id, x: 5, y: -3 });
  check('자리는 0~1 안으로 들어온다', () => assert.ok(wild.x === 1 && wild.y === 0));

  const hiddenMove = await ask(ca.sock, 'mod:trpg-chars:place', { id: cNpc.char.id, on: true });
  check('숨긴 카드의 토큰은 플레이어가 못 건드린다', () => assert.ok(hiddenMove.error));
  const gmMove = await ask(cgm.sock, 'mod:trpg-chars:place', { id: cNpc.char.id, on: true, x: 0.4 });
  await sleep(250);
  check('GM은 숨긴 카드도 무대에 올린다', () => assert.ok(gmMove.ok));
  check('숨긴 카드의 자리는 플레이어에게 가지 않는다', () =>
    assert.ok(!ca.charMoves.some((m) => m.id === cNpc.char.id)));

  // (7) 자료함에서 그림을 빼도 실물은 남는다 (카드가 깨지지 않게)
  const delFace = await api(`/api/gm/library/${npcFace}`, { method: 'DELETE', headers: CGM });
  const npcStill = await fetch(`${BASE}/f/${npcFace}?gm=${encodeURIComponent(cRoom.data.gmToken)}`);
  check('카드가 쓰는 그림은 지워지지 않는다', () =>
    assert.ok(delFace.status === 200 && npcStill.status === 200));

  // (8) 다른 방·모듈 끄기
  const cAlien = await fetch(`${BASE}/f/${faceId}?t=${encodeURIComponent(A.token)}`);
  check('다른 방 사람은 카드 그림을 못 받는다', () => assert.strictEqual(cAlien.status, 404));
  await api('/api/gm/modules', { method: 'PUT', headers: CGM, body: { id: 'trpg-chars', on: false } });
  const lockedFace = await fetch(`${BASE}/f/${faceId}?t=${encodeURIComponent(cB.token)}`);
  check('모듈을 끄면 카드 그림도 잠긴다 (404)', () => assert.strictEqual(lockedFace.status, 404));
  const offEdit = await ask(ca.sock, 'mod:trpg-chars:save', { op: 'save', char: { name: '꺼진 뒤' } });
  check('모듈을 끄면 카드도 못 만든다', () => assert.ok(offEdit.error));

  [ca, cb, cgm].forEach((c) => c.sock.disconnect());

  section(6, 'AI 시나리오 보조');
  // 「GM 전용」과 「원본은 새어 나가지 않는다」, 그리고 「다시 안 읽어도 된다」가 핵심이다.
  // 모델은 브라우저가 부르므로 여기서는 서버가 맡은 몫만 확인한다.
  const aiRoom = await api('/api/rooms', {
    method: 'POST', body: { name: 'AI 방', gmNickname: '진행자', modules: ['ai'] },
  });
  const AIGM = { 'x-gm-token': aiRoom.data.gmToken };
  const aiJoin = (await api(`/api/rooms/by-code/${aiRoom.data.room.code}/join`,
    { method: 'POST', body: { nickname: '손님' } })).data;
  const aigm = await connect({ gmToken: aiRoom.data.gmToken });
  const aipl = await connect({ playerToken: aiJoin.token });

  // (1) 작품 — GM만
  const aiHello0 = await ask(aigm.sock, 'mod:ai:hello', {});
  check('처음에는 작품이 없다', () => assert.strictEqual(aiHello0.works.length, 0));
  const aiMade = await ask(aigm.sock, 'mod:ai:work', { op: 'add', name: '무한의 기억' });
  const aiWork = aiMade.work?.id;
  check('GM이 작품을 만든다', () => assert.strictEqual(aiMade.work.name, '무한의 기억'));
  const aiSneak = await ask(aipl.sock, 'mod:ai:work', { op: 'add', name: '몰래' });
  check('플레이어는 작품을 못 만든다', () => assert.ok(aiSneak.error));
  const aiPeek = await ask(aipl.sock, 'mod:ai:hello', {});
  check('플레이어는 목록도 못 본다', () => assert.ok(aiPeek.error));

  // (2) 자료 올리기 — 폴더 안 경로까지 함께
  const aiForm = new FormData();
  aiForm.append('paths', JSON.stringify(['무한의기억/1장.txt']));
  aiForm.append('files', new Blob([Buffer.from('아무 글이나', 'utf8')], { type: 'text/plain' }), '1장.txt');
  const aiUp = await api(`/api/gm/ai/work/${aiWork}/upload`, { method: 'POST', headers: AIGM, form: aiForm });
  check('자료를 올린다', () => assert.strictEqual(aiUp.status, 200));
  const aiDoc = aiUp.data.docs[0];
  check('폴더 안 경로가 남는다', () => assert.strictEqual(aiDoc.path, '무한의기억/1장.txt'));
  check('아직 안 읽은 상태다', () => assert.strictEqual(aiDoc.status, 'wait'));

  const aiPlForm = new FormData();
  aiPlForm.append('files', new Blob([Buffer.from('x')], { type: 'text/plain' }), 'x.txt');
  const aiPlUp = await api(`/api/gm/ai/work/${aiWork}/upload`, {
    method: 'POST', headers: { 'x-player-token': aiJoin.token }, form: aiPlForm,
  });
  check('플레이어는 자료를 못 올린다 (403)', () => assert.strictEqual(aiPlUp.status, 403));

  // (3) 원본은 자료함에 뜨지 않고, 플레이어에게도 안 간다
  const aiLib = await api('/api/gm/library', { headers: AIGM });
  check('시나리오 원본은 자료함에 안 뜬다', () =>
    assert.ok(!(aiLib.data.files || []).some((f) => f.id === aiDoc.fileId)));
  const aiByPlayer = await fetch(`${BASE}/f/${aiDoc.fileId}?t=${encodeURIComponent(aiJoin.token)}`);
  check('플레이어는 원본을 못 받는다 (404)', () => assert.strictEqual(aiByPlayer.status, 404));
  const aiByGm = await fetch(`${BASE}/f/${aiDoc.fileId}?gm=${encodeURIComponent(aiRoom.data.gmToken)}`);
  check('GM은 원본을 받는다', () => assert.strictEqual(aiByGm.status, 200));

  // (4) 읽어 낸 조각 넣기
  const aiPages = [
    { page: 1, heading: '서재', text: '백작은 9시에 서재에 있었다고 말했다.' },
    { page: 2, text: '하녀는 10시에 정원에서 비명을 들었다.' },
    { page: 3, text: '' },
  ];
  const aiIn = await ask(aigm.sock, 'mod:ai:ingest', { docId: aiDoc.id, pages: aiPages });
  check('조각을 넣는다 (빈 쪽은 버린다)', () => assert.strictEqual(aiIn.count, 2));
  check('읽은 상태가 된다', () => assert.strictEqual(aiIn.doc.status, 'done'));
  const aiAgain = await ask(aigm.sock, 'mod:ai:ingest', { docId: aiDoc.id, pages: aiPages });
  check('다시 읽으면 갈아 끼운다 (겹치지 않는다)', () => assert.strictEqual(aiAgain.count, 2));
  const aiPlIngest = await ask(aipl.sock, 'mod:ai:ingest', { docId: aiDoc.id, pages: aiPages });
  check('플레이어는 조각을 못 넣는다', () => assert.ok(aiPlIngest.error));

  // (5) 검색 — 질문과 가까운 조각이 위로 온다
  const aiFind = await ask(aigm.sock, 'mod:ai:search', { workId: aiWork, q: '하녀가 비명을 들은 시각은?' });
  check('가까운 조각이 첫 줄에 온다', () => assert.ok(aiFind.hits[0].text.includes('비명')));
  check('찾은 줄에 자료 이름이 붙는다', () => assert.strictEqual(aiFind.hits[0].docName, '1장.txt'));
  const aiNone = await ask(aigm.sock, 'mod:ai:search', { workId: aiWork, q: '우주선 격납고 암호' });
  check('없는 이야기는 안 걸린다', () => assert.strictEqual(aiNone.hits.length, 0));

  // (6) 문답 기록
  await ask(aigm.sock, 'mod:ai:log', {
    workId: aiWork, question: '백작의 알리바이는?', answer: '9시에 서재에 있었다고 말했다.',
    cites: [{ n: 1, quote: '백작은 9시에 서재에 있었다고 말했다.', ok: true }], model: 'gpt-5', ok: true,
  });
  const aiHello1 = await ask(aigm.sock, 'mod:ai:hello', { workId: aiWork });
  check('문답이 기록된다', () => assert.strictEqual(aiHello1.asks.at(-1).question, '백작의 알리바이는?'));

  // (7) 내보내기 → 불러오기 (다시 안 읽어도 되게)
  const aiExp = await api(`/api/gm/ai/work/${aiWork}/export`, { headers: AIGM });
  check('내보내기가 된다', () => assert.strictEqual(aiExp.data.format, 'mm-ai'));
  check('조각이 담긴다', () => assert.strictEqual(aiExp.data.chunks.length, 2));

  const aiImpForm = new FormData();
  aiImpForm.append('data', new Blob([Buffer.from(JSON.stringify(aiExp.data), 'utf8')],
    { type: 'application/json' }), '무한의기억.mmai.json');
  const aiImp = await api('/api/gm/ai/import', { method: 'POST', headers: AIGM, form: aiImpForm });
  check('불러오기가 된다', () => assert.ok(aiImp.data.ok));
  check('자료와 조각이 그대로 들어온다', () =>
    assert.ok(aiImp.data.docs === 1 && aiImp.data.chunks === 2));
  const aiCopy = await ask(aigm.sock, 'mod:ai:search', { workId: aiImp.data.workId, q: '비명' });
  check('불러온 작품에서도 찾아진다', () => assert.ok(aiCopy.hits.length >= 1));
  const aiBadForm = new FormData();
  aiBadForm.append('data', new Blob([Buffer.from('{"format":"남의 것"}', 'utf8')]), 'x.json');
  const aiBad = await api('/api/gm/ai/import', { method: 'POST', headers: AIGM, form: aiBadForm });
  check('엉뚱한 파일은 막는다 (400)', () => assert.strictEqual(aiBad.status, 400));

  // (8) 남의 방 GM은 손댈 수 없다
  const aiOther = await api('/api/rooms', {
    method: 'POST', body: { name: '남의 AI 방', gmNickname: 'GM', modules: ['ai'] },
  });
  const aiOtherExp = await api(`/api/gm/ai/work/${aiWork}/export`,
    { headers: { 'x-gm-token': aiOther.data.gmToken } });
  check('남의 방 GM은 내보내지 못한다 (404)', () => assert.strictEqual(aiOtherExp.status, 404));
  const aiOtherSock = await connect({ gmToken: aiOther.data.gmToken });
  const aiOtherFind = await ask(aiOtherSock.sock, 'mod:ai:search', { workId: aiWork, q: '비명' });
  check('남의 방 작품은 찾아지지 않는다', () => assert.ok(aiOtherFind.error));
  aiOtherSock.sock.disconnect();

  // (9) 자료함에서 지워도 실물은 남는다 (다시 읽을 수 있게)
  const aiDel = await api(`/api/gm/library/${aiDoc.fileId}`, { method: 'DELETE', headers: AIGM });
  const aiStill = await fetch(`${BASE}/f/${aiDoc.fileId}?gm=${encodeURIComponent(aiRoom.data.gmToken)}`);
  check('읽을 자료의 원본은 지워지지 않는다', () =>
    assert.ok(aiDel.status === 200 && aiStill.status === 200));

  // (10) 모듈을 끄면 전부 막힌다
  await api('/api/gm/modules', { method: 'PUT', headers: AIGM, body: { id: 'ai', on: false } });
  const aiOffExp = await api(`/api/gm/ai/work/${aiWork}/export`, { headers: AIGM });
  check('모듈을 끄면 내보내기도 막힌다 (404)', () => assert.strictEqual(aiOffExp.status, 404));
  const aiOffFind = await ask(aigm.sock, 'mod:ai:search', { workId: aiWork, q: '비명' });
  check('모듈을 끄면 찾기도 막힌다', () => assert.ok(aiOffFind.error));

  // (11) 방을 지우면 읽어 둔 것도 함께 사라진다
  const { db: aidb } = require(path.join(H.CORE, 'src', 'db.js'));
  const aiChunksBefore = aidb.prepare('SELECT COUNT(*) c FROM ai_chunks WHERE room_id = ?')
    .get(aiRoom.data.room.id).c;
  [aigm, aipl].forEach((c) => c.sock.disconnect());
  await api('/api/gm/room', { method: 'DELETE', headers: AIGM, body: { confirmCode: aiRoom.data.room.code } });
  const aiChunksAfter = aidb.prepare('SELECT COUNT(*) c FROM ai_chunks WHERE room_id = ?')
    .get(aiRoom.data.room.id).c;
  check('방을 지우면 읽어 둔 조각도 사라진다', () =>
    assert.ok(aiChunksBefore > 0 && aiChunksAfter === 0));


  H.done();
})();
