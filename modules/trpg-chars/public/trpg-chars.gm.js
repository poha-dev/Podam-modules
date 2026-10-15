/* 👥 캐릭터 카드 — GM 화면
   자기 탭을 만들지 않고 🎲 간이 TRPG 무대에 얹힌다 (attachTo). */
(function () {
  'use strict';

  function loadUi() {
    if (window.TRPGChars) return Promise.resolve();
    if (!loadUi.p) {
      loadUi.p = new Promise((resolve, reject) => {
        const el = document.createElement('script');
        el.src = '/modules/trpg-chars.ui.js';
        el.onload = resolve;
        el.onerror = () => reject(new Error('캐릭터 화면을 불러오지 못했습니다'));
        document.head.appendChild(el);
      });
    }
    return loadUi.p;
  }

  MM.Panels.define({
    id: 'trpg-chars',
    side: 'gm',
    attachTo: 'trpg',
    async mount(host) {
      try {
        await loadUi();
      } catch (e) {
        return console.warn('[모듈]', e.message);
      }
      TRPGChars.mount(host);
    },
  });
})();
