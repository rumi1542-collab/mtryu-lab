/* 내 정보 입력창 (학교·학번·이름·별명)
   lab-bar.js가 필요할 때 불러와요. 메인(mtryu-lab.vercel.app)과 같은 주소의 페이지에서만 열려요
   (학교 검색 서버 /api/schools 를 같은 주소로 부르기 때문이에요).
     window.MtryuMeDialog.open({ required: true,   // true면 닫을 수 없어요 (정보가 없을 때)
                                 strict: false,    // true면 나이스에서 고른 학교만 받아요 (순위 서버에 올릴 때)
                                 back: 'https://…' // 저장한 뒤 돌아갈 실험실 주소 (lab-bar.js가 이미 검사했어요)
                               })
   저장은 window.MtryuMe.set()이 해요. 별명 검사 목록은 api/_names.js와 같아요. */
(function () {
  'use strict';
  if (window.MtryuMeDialog) return;

  var BAD_WORDS = ['시발','씨발','씨바','시바','쉬발','시팔','씨팔','십팔','씹','병신','븅신','ㅂㅅ','ㅄ','ㅅㅂ','ㅆㅂ','지랄','ㅈㄹ','좆','존나','졸라','개새끼','새끼','섹스','보지','자지','창녀','걸레','꺼져','닥쳐','미친','ㅁㅊ','엿먹','애미','느금','니미','쌍놈','쌍년','썅','뒤져','fuck','shit','bitch','asshole','dick','pussy','porn','sex','nigg','cunt'];
  function badName(s) {
    var n = String(s || '').toLowerCase().replace(/[^가-힣ㄱ-ㅎㅏ-ㅣa-z]/g, '');
    return BAD_WORDS.some(function (w) { return n.indexOf(w) >= 0; });
  }
  function noSpace(s, n) { return String(s == null ? '' : s).replace(/[<>\s\u0000-\u001f]/g, '').slice(0, n); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  var CSS =
    ':host{all:initial}*{box-sizing:border-box}' +
    ".ov{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(43,15,63,.62);font-family:'Noto Sans KR','Malgun Gothic','Apple SD Gothic Neo',system-ui,sans-serif;color:#2B0F3F}" +
    '.dlg{width:100%;max-width:480px;max-height:calc(100vh - 32px);max-height:calc(100dvh - 32px);overflow:auto;display:flex;flex-direction:column;gap:14px;background:#fff;border:2px solid #2B0F3F;border-radius:16px;padding:22px;box-shadow:6px 6px 0 #D81B7A}' +
    'h2{margin:0;font-size:22px;font-weight:900}.sub{margin:0;font-size:14px;line-height:1.55;color:#5A4670}' +
    '.fld{display:flex;flex-direction:column;gap:5px;min-width:0}.fld>label,.fld>.lb{font-size:14px;font-weight:700}' +
    '.fld small{font-size:12.5px;line-height:1.4;color:#5A4670}' +
    '.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.grid .full{grid-column:1/-1}' +
    '@media (max-width:420px){.grid{grid-template-columns:1fr}}' +
    '.in{width:100%;min-height:44px;padding:0 12px;border:2px solid #2B0F3F;border-radius:10px;font:inherit;font-size:16px;color:#2B0F3F;background:#fff}' +
    '.in:focus-visible,button:focus-visible{outline:3px solid #FF2D95;outline-offset:1px}' +
    '.res{list-style:none;margin:0;padding:0;border:2px solid #E6D8F2;border-radius:10px;max-height:200px;overflow:auto}.res:empty{display:none}' +
    '.res li+li{border-top:1px solid #E6D8F2}' +
    '.res button{display:flex;flex-direction:column;align-items:flex-start;gap:2px;width:100%;min-height:44px;padding:8px 12px;border:0;background:#fff;font:inherit;font-size:15px;font-weight:700;color:#2B0F3F;text-align:left;cursor:pointer}' +
    '.res button:hover,.res button:focus-visible{background:#F0DDFA}.res small{font-size:12.5px;font-weight:400;color:#5A4670}' +
    '.quick{display:flex;flex-wrap:wrap;gap:6px}.quick:empty{display:none}' +
    '.chip{min-height:36px;padding:0 12px;border:2px solid #E6D8F2;border-radius:999px;background:#fff;font:inherit;font-size:14px;font-weight:500;color:#2B0F3F;cursor:pointer}' +
    '.chip:hover{background:#F0DDFA;border-color:#7719AA}' +
    '.msg{margin:0;min-height:1.2em;font-size:13.5px;line-height:1.45;color:#5A4670}.msg.err{color:#B3004D;font-weight:700}' +
    '.picked{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 12px;border:2px solid #7719AA;border-radius:10px;background:#F0DDFA}' +
    '.picked b{font-size:15px}.picked span{font-size:13px;color:#5A4670}' +
    '[hidden]{display:none!important}' +
    '.act{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;align-items:center;margin-top:2px}.act .sp{flex:1}' +
    '.bt{min-height:44px;padding:0 16px;border:2px solid #2B0F3F;border-radius:10px;background:#fff;font:inherit;font-size:15px;font-weight:700;color:#2B0F3F;cursor:pointer}' +
    '.bt.pri{background:#7719AA;border-color:#7719AA;color:#fff}.bt:disabled{opacity:.45;cursor:not-allowed}' +
    '.bt.lk{min-height:36px;padding:0 6px;border-color:transparent;background:none;font-weight:500;color:#5A4670;text-decoration:underline}';

  var host = null, st = null;

  function close() {
    if (!host) return;
    document.removeEventListener('keydown', st.onKey, true);
    host.remove(); document.documentElement.style.overflow = st.prevOverflow;
    var f = st.lastFocus; host = null; st = null;
    if (f && f.focus) { try { f.focus(); } catch (e) {} }
  }

  function open(opts) {
    opts = opts || {};
    if (host) { st.opts = opts; render(); return; }   // 이미 열려 있으면 새 조건만 반영해요
    st = { opts: opts, picked: null, cache: {}, seq: 0, timer: 0, ctl: null, quickLoaded: false, lastFocus: document.activeElement, prevOverflow: document.documentElement.style.overflow };
    host = document.createElement('div');
    host.id = 'mtryu-medialog';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483500;margin:0;padding:0;';
    st.root = host.attachShadow({ mode: 'open' });
    document.body.appendChild(host);
    document.documentElement.style.overflow = 'hidden';
    st.onKey = onKey; document.addEventListener('keydown', onKey, true);
    var me = window.MtryuMe ? (window.MtryuMe.get() || window.MtryuMe.getRaw()) : null;   // 옛 정보(별명이 없는)도 미리 채워 줘요
    if (me && me.school && me.school.name) st.picked = { name: me.school.name, region: me.school.region || '', kind: '', code: me.school.code || '', edu: me.school.edu || '' };
    if (opts.strict && st.picked && !(st.picked.code && st.picked.region)) st.picked = null;   // 직접 쓴 학교는 순위 서버용으로 인정되지 않아서 검색부터 다시 해요
    st.init = { sid: me ? me.sid : '', name: me ? me.name : '', nick: me ? me.nick : '', has: !!(me && window.MtryuMe.get()) };
    render();
  }

  function onKey(e) {
    if (!host) return;
    if (e.key === 'Escape') { if (!st.opts.required) { e.preventDefault(); e.stopPropagation(); close(); } return; }
    if (e.key !== 'Tab') return;
    var f = Array.prototype.filter.call(st.root.querySelectorAll('button,input'), function (x) { return !x.disabled && !x.hidden && x.offsetParent !== null; });
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1], cur = st.root.activeElement;
    if (!cur) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && cur === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && cur === last) { e.preventDefault(); first.focus(); }
  }

  function render() {
    var o = st.opts, root = st.root;
    // 입력 중이던 값은 다시 그려도 지키기 위해, 이미 그려져 있으면 값만 읽어 둬요
    var keep = { sid: st.init.sid, name: st.init.name, nick: st.init.nick };
    var q = function (id) { return root.getElementById ? root.getElementById(id) : root.querySelector('#' + id); };
    if (q('sid')) { keep.sid = q('sid').value; keep.name = q('name').value; keep.nick = q('nick').value; }
    root.innerHTML = '<style>' + CSS + '</style>' +
      '<div class="ov" id="ov"><div class="dlg" id="dlg" role="dialog" aria-modal="true" aria-labelledby="ttl">' +
      '<h2 id="ttl">' + (o.required ? '내 정보를 입력해 주세요' : '내 정보') + '</h2>' +
      '<p class="sub">한 번만 입력하면 모든 실험실에서 다시 쓰지 않아도 돼요. 이 기기의 브라우저에 저장돼요.</p>' +
      '<div class="fld"><span class="lb" id="schlb">학교</span>' +
        '<div id="picked" class="picked" hidden><div><b id="pname"></b> <span id="psub"></span></div><button type="button" id="repick" class="bt lk">다시 고르기</button></div>' +
        '<div id="search" class="fld"><input id="sch" class="in" type="search" placeholder="학교 이름을 두 글자 이상 써 보세요 (예: 선운)" autocomplete="off" maxlength="20" aria-labelledby="schlb">' +
        '<div id="quick" class="quick" aria-label="자주 쓰는 학교"></div><ul id="res" class="res"></ul><p id="smsg" class="msg" role="status" aria-live="polite"></p></div></div>' +
      '<div class="grid">' +
        '<div class="fld"><label for="sid">학번 (숫자)</label><input id="sid" class="in" type="text" inputmode="numeric" autocomplete="off" maxlength="8" placeholder="예: 10215"><small>다른 사람에게 보이지 않아요.</small></div>' +
        '<div class="fld"><label for="name">이름</label><input id="name" class="in" type="text" autocomplete="off" maxlength="10" placeholder="이름"><small>위쪽 이름표에만 보여요.</small></div>' +
        '<div class="fld full"><label for="nick">별명</label><input id="nick" class="in" type="text" autocomplete="off" maxlength="8" placeholder="띄어쓰기 없이 8글자까지"><small>순위에 이 이름으로 올라가요. 바른 말로 써 주세요.</small></div>' +
      '</div>' +
      '<p id="emsg" class="msg err" role="alert"></p>' +
      '<p class="msg">접속 횟수는 학교와 익명 번호로만 세요. 이름·학번·별명은 접속 집계에 보내지 않아요.</p>' +
      '<div class="act">' + (!o.required && st.init.has ? '<button type="button" id="del" class="bt lk">내 정보 지우기</button>' : '') + '<span class="sp"></span>' +
        (o.required ? '' : '<button type="button" id="cls" class="bt">닫기</button>') +
        '<button type="button" id="save" class="bt pri" disabled>' + (o.required ? '저장하고 시작' : '저장') + '</button></div>' +
      '</div></div>';
    q('sid').value = keep.sid || ''; q('name').value = keep.name || ''; q('nick').value = keep.nick || '';
    bind(q);
    paintPicked(q); validate(q);
    loadQuick(q);
    var target = !st.picked ? q('sch') : (!q('sid').value ? q('sid') : (!q('name').value ? q('name') : q('nick')));
    try { target.focus(); } catch (e) {}
  }

  function paintPicked(q) {
    var p = st.picked;
    q('picked').hidden = !p; q('search').hidden = !!p;
    if (p) { q('pname').textContent = p.name; q('psub').textContent = [p.region, p.kind].filter(Boolean).join(' · '); }
  }
  function validate(q) {
    var sid = q('sid').value.trim(), name = noSpace(q('name').value, 10), nick = noSpace(q('nick').value, 8);
    q('save').disabled = !(st.picked && /^\d{1,8}$/.test(sid) && name && nick);
  }

  function pick(q, s) {
    st.picked = { name: s.name, region: s.region || '', kind: s.kind || '', code: s.code || '', edu: s.edu || '' };
    paintPicked(q); validate(q); q('sid').focus();
  }
  function results(q, list, hint) {
    var res = q('res'), msg = q('smsg'); res.innerHTML = '';
    if (hint) {   // 자주 쓰는 학교 버튼으로 검색했으면 하나로 정해질 때 바로 골라요
      var m = list.filter(function (x) { return x.name === hint.name && (!hint.region || x.region === hint.region); });
      if (m.length === 1) { pick(q, m[0]); return; }
    }
    if (!list.length) { msg.className = 'msg'; msg.textContent = '찾는 학교가 없어요. 이름을 조금 다르게 써 보세요.'; return; }
    msg.className = 'msg'; msg.textContent = list.length + '개를 찾았어요. 우리 학교를 눌러 주세요.';
    list.slice(0, 15).forEach(function (s) {
      var li = el('li'), b = el('button'); b.type = 'button';
      b.appendChild(el('span', '', s.name));
      b.appendChild(el('small', '', [s.region, s.kind, s.addr].filter(Boolean).join(' · ')));
      b.addEventListener('click', function () { pick(q, s); });
      li.appendChild(b); res.appendChild(li);
    });
  }
  function failed(q, text) {   // 검색이 안 될 때: 순위 서버용(strict)이 아니면 입력한 이름 그대로 쓸 수 있어요 (순위 게임은 나중에 검색해서 다시 골라야 해요)
    var res = q('res'), msg = q('smsg'); res.innerHTML = '';
    msg.className = 'msg err';
    if (st.opts.strict) { msg.textContent = '학교 검색이 지금 안 돼요. 잠시 뒤에 다시 해 주세요.'; return; }
    msg.textContent = '학교 검색이 지금 안 돼요. 아래 버튼으로 입력한 이름 그대로 쓸 수 있어요. (강 건너기·동전 실험실은 검색이 될 때 학교를 다시 골라야 해요)';
    var li = el('li'), b = el('button'); b.type = 'button';
    b.appendChild(el('span', '', '‘' + text + '’ 그대로 사용'));
    b.addEventListener('click', function () { pick(q, { name: text }); });
    li.appendChild(b); res.appendChild(li);
  }
  function search(q, text, hint) {
    if (st.ctl) { try { st.ctl.abort(); } catch (e) {} st.ctl = null; }
    var my = ++st.seq;
    if (text.length < 2) { q('res').innerHTML = ''; q('smsg').textContent = ''; return; }
    if (st.cache[text]) { results(q, st.cache[text], hint); return; }
    q('smsg').className = 'msg'; q('smsg').textContent = '찾는 중…';
    st.ctl = 'AbortController' in window ? new AbortController() : null;
    fetch('/api/schools?q=' + encodeURIComponent(text), st.ctl ? { signal: st.ctl.signal } : {})
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (o) {
        if (!host || my !== st.seq) return;
        if (!o.ok || !o.j || !Array.isArray(o.j.schools)) throw new Error('bad');
        st.cache[text] = o.j.schools; results(q, o.j.schools, hint);
      })
      .catch(function (err) { if (!host || my !== st.seq || (err && err.name === 'AbortError')) return; failed(q, text); });
  }
  function loadQuick(q) {
    if (st.quickLoaded || st.picked) return;
    st.quickLoaded = true;
    fetch('/api/config').then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!host || !j || !Array.isArray(j.schools)) return;
      var box = q('quick'); if (!box) return;
      j.schools.slice(0, 8).forEach(function (label) {
        if (typeof label !== 'string') return;
        var b = el('button', 'chip', label); b.type = 'button';
        b.addEventListener('click', function () {
          var nm = label.replace(/\([^)]*\)$/, '');
          q('sch').value = nm; clearTimeout(st.timer);
          search(q, nm, { name: nm, region: (j.regions && j.regions[label]) || '' });
        });
        box.appendChild(b);
      });
    }).catch(function () {});
  }

  function bind(q) {
    var o = st.opts;
    q('sch').addEventListener('input', function () { clearTimeout(st.timer); var t = q('sch').value.trim(); st.timer = setTimeout(function () { search(q, t); }, 400); });
    q('sch').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(st.timer); search(q, q('sch').value.trim()); } });
    q('repick').addEventListener('click', function () { st.picked = null; paintPicked(q); validate(q); q('sch').focus(); });
    q('sid').addEventListener('input', function () { q('sid').value = q('sid').value.replace(/\D/g, '').slice(0, 8); q('emsg').textContent = ''; validate(q); });
    q('name').addEventListener('input', function () { q('emsg').textContent = ''; validate(q); });
    q('nick').addEventListener('input', function () { q('emsg').textContent = ''; validate(q); });
    ['sid', 'name', 'nick'].forEach(function (id) { q(id).addEventListener('keydown', function (e) { if (e.key === 'Enter' && !q('save').disabled) q('save').click(); }); });

    q('save').addEventListener('click', function () {
      var nick = noSpace(q('nick').value, 8), emsg = q('emsg');
      if (badName(nick)) { emsg.textContent = '별명에 쓸 수 없는 말이 들어 있어요. 다른 별명을 써 주세요.'; q('nick').focus(); return; }
      if (o.strict && !(st.picked.code && st.picked.region)) { emsg.textContent = '나이스에서 찾은 학교를 골라 주세요.'; return; }
      var ok = window.MtryuMe.set({ school: st.picked, sid: q('sid').value.trim(), name: noSpace(q('name').value, 10), nick: nick });
      if (!ok) { emsg.textContent = '이 브라우저에서는 저장할 수 없어요. 시크릿(사생활 보호) 창이라면 일반 창에서 열어 주세요.'; return; }
      var back = o.back, h = back && window.MtryuMe.handoff(back);
      close();
      if (h) location.href = h;
    });
    if (q('cls')) q('cls').addEventListener('click', close);
    if (q('del')) q('del').addEventListener('click', function () { close(); window.MtryuMe.clear(); });   // 지우면 lab-bar가 곧바로 다시 입력창을 열어요
    q('ov').addEventListener('mousedown', function (e) { if (e.target === q('ov') && !st.opts.required) close(); });
  }

  window.MtryuMeDialog = { open: open, close: close, isOpen: function () { return !!host; } };
})();
