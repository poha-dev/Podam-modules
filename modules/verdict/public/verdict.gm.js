/* 🔑 정답 판정 — GM 패널
   배역마다 「정답:답변」 표를 두고, 밖에서 만든 글을 그대로 붙여 넣거나 파일로 주고받는다. */
(function () {
  'use strict';

  MM.Panels.define({
    id: 'verdict',
    side: 'gm',
    label: '🔑 정답표',
    mount(root, ctx) {
      let state = { settings: {}, tables: [], log: [] };
      let pick = '';                       // 지금 보고 있는 배역 ('' = 공용)
      let dirty = false;                   // 저장하지 않은 편집이 있는지
      const esc = MM.esc;
      const current = () => state.tables.find((t) => (t.roleId || '') === pick) || state.tables[0] || {};

      const load = async () => {
        state = await ctx.api('/api/gm/verdict', { headers: ctx.AUTH() });
        dirty = false;
        paint();
      };

      function paint() {
        const t = current();
        const s = state.settings || {};
        root.innerHTML = `
          <div class="faint" style="margin-bottom:8px">
            배역마다 <b>정답:답변</b>을 한 줄에 하나씩 적어 둡니다.
            그 배역을 맡은 플레이어가 정답을 내면 <b>적어 둔 답변이 자동으로</b> 나갑니다.
          </div>

          <div class="row" style="margin-bottom:6px">
            <select id="vdRole" class="grow">
              ${state.tables.map((x) => `<option value="${x.roleId || ''}"${(x.roleId || '') === pick ? ' selected' : ''}>
                ${esc(x.name)} (${x.count})</option>`).join('')}
            </select>
            <button class="ghost" id="vdTestBtn" title="보내지 않고 확인만">🧪</button>
          </div>

          <textarea id="vdText" rows="12" spellcheck="false"
            placeholder="타임루프:흥미로운 이야기입니다만, 짐작 가는 것은 없습니다.&#10;명예:마왕님의 명언입니다.">${esc(t.text || '')}</textarea>
          <div class="faint" style="margin:4px 0 6px">
            줄바꿈이 필요하면 답변 안에 <code>\\n</code> 을 적으세요. <code>#</code> 으로 시작하면 메모입니다.
          </div>
          <button class="primary" id="vdSave" style="width:100%">${esc(t.name || '')} 정답표 저장</button>

          <div class="row" style="margin-top:8px">
            <button class="ghost grow" id="vdExport">📥 전체 내보내기</button>
            <button class="ghost grow" id="vdImport">📤 불러오기</button>
            <input type="file" id="vdFile" class="hidden" accept=".txt,.md,.csv">
          </div>

          <div class="vd-box" style="margin-top:12px">
            <div class="vd-head">답변 보낼 이름 · 못 찾았을 때 · GM 알림</div>
            <input id="vdNpc" value="${esc(s.npcName || '')}" placeholder="보낼 이름 (비우면 이름 없이)" maxlength="30">
            <input id="vdMissText" style="margin-top:6px" maxlength="300"
                   value="${esc(s.missText || '')}" placeholder="못 찾았을 때 문구 (비우면 아무 말도 안 함)">
            <div class="row" style="margin-top:6px">
              <select id="vdFeed" title="플레이어의 문답을 GM 화면에 얼마나 띄울지">
                <option value="hit"${(s.gmFeed || 'hit') === 'hit' ? ' selected' : ''}>맞혔을 때만 알림</option>
                <option value="all"${s.gmFeed === 'all' ? ' selected' : ''}>문답 전부 알림</option>
                <option value="none"${s.gmFeed === 'none' ? ' selected' : ''}>알림 없음 (기록만)</option>
              </select>
            </div>
            <div class="faint" style="margin-top:4px">
              문답이 잦으면 알림에 파묻혀 진짜 질문을 놓칩니다. 기본은 <b>맞혔을 때만</b>입니다.
              알리지 않아도 <b>대화 기록에는 그대로 남습니다.</b>
            </div>
            <button class="ghost" id="vdSaveSettings" style="width:100%;margin-top:6px">설정 저장</button>
          </div>

          <div class="vd-head" style="margin-top:12px">주고받은 기록</div>
          <div id="vdLog">${logHtml()}</div>`;
      }

      function logHtml() {
        if (!state.log || state.log.length === 0) return '<div class="empty">아직 없습니다.</div>';
        const nameOf = (id) => ctx.participants().find((p) => p.id === id)?.nickname || '(나간 사람)';
        return state.log.slice(0, 20).map((l) => `
          <div class="vd-hit${l.matched ? '' : ' off'}">
            <b>${esc(nameOf(l.participantId))}</b> ${l.matched ? '✔' : '✗'} ${esc(l.asked)}
            <span class="faint">${MM.timeOf(l.createdAt)}</span>
          </div>`).join('');
      }

      // ── 동작 ────────────────────────────────────────────────────────────
      root.addEventListener('input', (e) => { if (e.target.id === 'vdText') dirty = true; });

      root.addEventListener('change', async (e) => {
        if (e.target.id === 'vdRole') {
          if (dirty && !confirm('저장하지 않은 내용이 있습니다. 그대로 넘어갈까요?')) {
            e.target.value = pick; return;
          }
          pick = e.target.value;
          paint();
        }
        if (e.target.id === 'vdFile') {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          const text = await file.text();
          const mode = confirm('지금 있는 정답표를 모두 지우고 파일 내용으로 바꿀까요?\n\n'
            + '확인 = 싹 바꾸기 · 취소 = 지금 것에 더하기') ? 'replace' : 'merge';
          try {
            const r = await ctx.api('/api/gm/verdict/import', {
              method: 'POST', headers: ctx.AUTH(), body: { text, mode },
            });
            state = r; dirty = false; paint();
            const miss = r.unknownRoles?.length
              ? ` (없는 배역 ${r.unknownRoles.join(', ')} 은 공용으로 넣었습니다)` : '';
            MM.toast(`${r.added}줄을 불러왔습니다${miss}`);
          } catch (err) { MM.toast(err.message, true); }
        }
      });

      root.addEventListener('click', async (e) => {
        try {
          if (e.target.id === 'vdSave') {
            const r = await ctx.api('/api/gm/verdict/table', {
              method: 'PUT', headers: ctx.AUTH(),
              body: { roleId: pick || null, text: root.querySelector('#vdText').value },
            });
            state = r; dirty = false; paint();
            MM.toast(`${r.count}줄을 저장했습니다`);
          }

          if (e.target.id === 'vdSaveSettings') {
            state = await ctx.api('/api/gm/verdict/settings', {
              method: 'PUT', headers: ctx.AUTH(),
              body: {
                npcName: root.querySelector('#vdNpc').value,
                gmFeed: root.querySelector('#vdFeed').value,
                missText: root.querySelector('#vdMissText').value,
              },
            });
            paint();
            MM.toast('설정을 저장했습니다');
          }

          if (e.target.id === 'vdExport') {
            window.open(`/api/gm/verdict/export?gm=${encodeURIComponent(ctx.token())}`, '_blank');
          }
          if (e.target.id === 'vdImport') root.querySelector('#vdFile').click();

          if (e.target.id === 'vdTestBtn') {
            const text = prompt('플레이어가 이렇게 냈다고 치고 확인합니다.\n(아무에게도 가지 않습니다)', '');
            if (!text) return;
            const r = await ctx.api('/api/gm/verdict/test', {
              method: 'POST', headers: ctx.AUTH(), body: { roleId: pick || null, text },
            });
            alert(r.matched ? `✔ ${r.answer}\n\n${r.reply}` : '✗ 맞는 답변이 없습니다.');
          }
        } catch (err) { MM.toast(err.message, true); }
      });

      // 플레이어가 정답을 낼 때마다 기록을 새로 받는다.
      ctx.socket?.on('verdict:quiet', () => load());     // 알림 없이 기록만 갱신
      ctx.socket?.on('verdict:event', (ev) => {
        load();
        if (ev.type === 'hit') MM.alertIncoming('정답', `${ev.nickname} — ${ev.asked}`, 'verdict');
      });

      load();
    },
  });
})();
