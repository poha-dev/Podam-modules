'use strict';
const W = require('./works');
const C = require('./chunks');
const S = require('./search');

/**
 * 🤖 AI 시나리오 보조 — GM이 자기 시나리오 자료를 읽혀 두고 진행 중에 물어보는 곳.
 *
 * **모델을 부르는 것은 서버가 아니라 GM의 브라우저다.** API 키를 각자의 브라우저에만
 * 두기로 했기 때문이다. 서버가 맡는 일은 셋뿐이다 — 원본 보관, 읽어 낸 조각 보관,
 * 질문에 맞는 조각 골라 주기. 키는 이 서버로 오지도 않고 남지도 않는다.
 *
 * 답은 반드시 조각을 근거로 달게 하고, 근거가 없으면 「자료에 없습니다」라고만 한다
 * (추리물에서 지어낸 답은 판을 망친다). 화면이 인용을 원문과 대조한다.
 */
module.exports = {
  id: 'ai',
  name: '🤖 AI 시나리오 보조',
  description: '시나리오 자료(PDF·그림·글)를 읽혀 두고 진행 중에 물어봅니다. 답에는 원문 인용이 붙고, 자료에 없으면 없다고 합니다. API 키는 각 GM의 브라우저에만 저장됩니다.',
  defaultOn: false,
  playerUi: false,                      // GM 전용 — 플레이어에게는 켜진 사실조차 알리지 않는다
  gmTab: { key: 'ai', label: '🤖 AI 보조' },
  events: ['mod:ai:hello', 'mod:ai:work', 'mod:ai:doc', 'mod:ai:ingest', 'mod:ai:search', 'mod:ai:log'],
  schema: require('./schema'),
  router: require('./routes').router,

  socket({ socket, on }) {
    const roomId = () => socket.data.roomId;
    /** GM만 쓴다. 플레이어가 이벤트 이름을 알아내도 아무것도 얻지 못한다. */
    const gmOnly = (ack) => {
      if (socket.data.role === 'gm') return false;
      ack?.({ error: '권한이 없습니다' });
      return true;
    };
    const mine = (workId, ack) => {
      const w = W.get(roomId(), workId);
      if (!w) ack?.({ error: '없는 작품입니다' });
      return w;
    };

    /** 들어올 때 한 벌 — 작품 목록과, 고른 작품의 자료·문답 기록. */
    on('mod:ai:hello', ({ workId } = {}, ack) => {
      if (gmOnly(ack)) return;
      const works = W.list(roomId());
      const pick = works.find((w) => w.id === workId) || works[0] || null;
      ack?.({
        works,
        workId: pick?.id || null,
        docs: pick ? W.docs(roomId(), pick.id) : [],
        asks: pick ? C.asks(roomId(), pick.id) : [],
      });
    });

    on('mod:ai:work', ({ op, id, name, note } = {}, ack) => {
      if (gmOnly(ack)) return;
      if (op === 'add') return ack?.({ ...W.create(roomId(), name, note), works: W.list(roomId()) });
      if (!mine(id, ack)) return;
      if (op === 'rename') return ack?.({ ...W.rename(roomId(), id, name, note), works: W.list(roomId()) });
      if (op === 'del') return ack?.({ ...W.remove(roomId(), id), works: W.list(roomId()) });
      ack?.({ error: '알 수 없는 요청입니다' });
    });

    on('mod:ai:doc', ({ op, id, workId, ids, status, error } = {}, ack) => {
      if (gmOnly(ack)) return;
      if (op === 'order') {
        if (!mine(workId, ack)) return;
        return ack?.({ ...W.reorder(roomId(), workId, ids), docs: W.docs(roomId(), workId) });
      }
      const d = W.getDoc(roomId(), id);
      if (!d) return ack?.({ error: '없는 자료입니다' });
      if (op === 'del') return ack?.({ ...W.removeDoc(roomId(), id), docs: W.docs(roomId(), d.work_id) });
      if (op === 'status') return ack?.(W.setStatus(roomId(), id, status, error));
      ack?.({ error: '알 수 없는 요청입니다' });
    });

    /** 브라우저가 모델에게 읽혀 온 결과. 옛 조각을 갈아 끼운다. */
    on('mod:ai:ingest', ({ docId, pages } = {}, ack) => {
      if (gmOnly(ack)) return;
      ack?.(C.ingest(roomId(), docId, pages));
    });

    /** 질문(또는 찾을 말)에 맞는 조각을 골라 준다. 모델은 브라우저가 부른다. */
    on('mod:ai:search', ({ workId, q, docIds, limit } = {}, ack) => {
      if (gmOnly(ack)) return;
      if (!mine(workId, ack)) return;
      const text = String(q || '').trim();
      if (!text) return ack?.({ hits: [] });
      ack?.({
        hits: S.search(roomId(), workId, text, {
          docIds,
          limit: Math.min(S.MAX_HITS, Math.max(1, Number(limit) || S.MAX_HITS)),
        }),
      });
    });

    /** 문답 기록. */
    on('mod:ai:log', ({ workId, question, answer, cites, model, ok } = {}, ack) => {
      if (gmOnly(ack)) return;
      if (!mine(workId, ack)) return;
      const gm = { id: socket.data.gmId, nickname: socket.data.nickname };
      ack?.(C.log(roomId(), workId, gm, { question, answer, cites, model, ok }));
    });
  },

  hooks: {
    // 원본이 사라지면 자료를 다시 읽을 수 없다 — 자료함 정리에서 지켜 준다.
    fileInUse: require('./files').fileInUse,
  },

  bundle: require('./bundle'),
  guide: require('./guide'),
};
