/* MT RYU의 수학 실험실 · 공통 상단 바 + 내 정보(필수 입력)
   모든 실험실 페이지의 <head>에 이 한 줄만 넣으면 맨 위에 항상 보이는 바가 생기고,
   내 정보(학교·학번·이름·별명)가 없으면 입력할 때까지 쓸 수 없게 막아요.
     <script src="https://mtryu-lab.vercel.app/lab-bar.js" defer></script>
   실험실이 늘어나면 아래 LABS 목록만 고치면 모든 페이지에 한꺼번에 반영돼요. */
(function () {
  'use strict';
  if (window.__mtryuLabBar || window.top !== window.self) return;   // 중복 실행·iframe 안에서는 만들지 않아요
  window.__mtryuLabBar = true;

  var HOME = 'https://mtryu-lab.vercel.app/';
  var LABS = [
    { id: 'math', name: '대수 기하 실험실', href: 'https://rumi1542-collab.github.io/mathoperation/' },
    { id: 'stat', name: '통계 실험실',      href: 'https://dataandstat.vercel.app/' },
    { id: 'prob', name: '확률 실험실',      href: 'https://mtryu-lab.vercel.app/probability/' },
    { id: 'game', name: '게임 수학 실험실', href: 'https://mancala-tutorial.vercel.app/' }
  ];

  /* ── 내 정보 ──────────────────────────────────────────────────────────
     저장 위치: 이 브라우저의 localStorage 'mtryu.me' (서버로는 보내지 않아요)
       { v:3, school:{name,region,code,edu}, gr:학년(0~6), cl:반(0~30), no:번호(0~60), name:'실명', nick:'별명', uid:'기기별 익명 번호' }
     · 실명·번호는 상단 이름표에만 보이고, 순위에는 별명과 학년·반만 올라가요 (번호는 서버로 보내지 않아요).
     · uid는 이름 없는 무작위 번호예요. 순위 기록에 함께 저장되지만 순위표에는 나오지 않고,
       나중에 로그인이 붙으면 '이 기기에서 한 기록 가져오기'에만 써요. 같은 학교·학년·반·번호로 다시 저장하면 그대로 두고,
       바뀌면(다른 학생이 이 컴퓨터를 쓰면) 새로 만들어요. (예전에 학번으로 저장한 사람은 같은 학교·이름이면 그대로 이어 써요)
     다른 주소(도메인)의 실험실로 넘어갈 때는 주소 끝에 #mtryu-me=... 를 붙여 건네고, 받는 쪽이 저장한 뒤 바로 지워요. */
  var ME_KEY = 'mtryu.me', HASH_KEY = 'mtryu-me=', HOME_ORIGIN = new URL(HOME).origin;
  /* ── 테스트 모드 ──────────────────────────────────────────────────────
     관리자 화면(/admin/)에서 켜요. 켜져 있는 동안은 접속 집계·순위 기록·학교 추가·시뮬레이터 올리기/판정을 서버에 보내지 않아요.
     저장 위치: localStorage 'mtryu.test' = 끝나는 시각(ms). 3시간이 지나면 저절로 꺼지고, 다른 주소의 실험실로 갈 때는 주소 끝에 끝나는 시각만 실어 보내요. */
  var TEST_KEY = 'mtryu.test', TEST_HASH = 'mtryu-test=', TEST_MAX = 3 * 3600 * 1000 + 60000;
  function testLeft() { try { var t = Number(localStorage.getItem(TEST_KEY)) || 0; return t > Date.now() ? t : 0; } catch (e) { return 0; } }
  function toNum(v, lo, hi) { var n = parseInt(String(v == null ? '' : v).replace(/\D/g, ''), 10); return isFinite(n) && n >= lo && n <= hi ? n : -1; }   // 범위 밖이거나 비어 있으면 -1
  function clean(s, n) { return String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n); }
  function noSpace(s, n) { return clean(s, 60).replace(/\s+/g, '').slice(0, n); }
  function validUid(u) { return typeof u === 'string' && /^[a-f0-9]{32}$/.test(u); }
  function newUid() {
    try { var a = new Uint8Array(16); crypto.getRandomValues(a); return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
    catch (e) { var s = ''; for (var i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16); return s; }
  }
  function loose(m) {   // 값을 다듬기만 해요 (비어 있어도 돼요). 입력창에 미리 채울 때 써요.
    if (!m || typeof m !== 'object') return null;
    var sc = m.school && typeof m.school === 'object' ? m.school : {};
    return {
      v: 3,
      school: { name: clean(sc.name, 40), region: clean(sc.region, 20), code: clean(sc.code, 20), edu: clean(sc.edu, 10) },
      gr: toNum(m.gr, 0, 6), cl: toNum(m.cl, 0, 30), no: toNum(m.no, 0, 60),   // 예전 학번 형식은 여기서 빠져서, 학년·반·번호를 다시 받아요
      name: noSpace(m.name, 10),
      nick: noSpace(m.nick, 8),
      uid: validUid(m.uid) ? m.uid : ''
    };
  }
  function sanitizeMe(m) {   // 학교·학년·반·번호·이름·별명이 모두 있을 때만 쓸 수 있는 정보로 인정해요 (옛 형식은 다시 받아요)
    var o = loose(m);
    return o && o.school.name && o.gr >= 0 && o.cl >= 0 && o.no >= 0 && o.name && o.nick && o.uid ? o : null;
  }
  function rawMe() { try { return loose(JSON.parse(localStorage.getItem(ME_KEY))); } catch (e) { return null; } }
  function readMe() { return sanitizeMe(rawMe()); }
  function writeMe(m) { try { localStorage.setItem(ME_KEY, JSON.stringify(m)); return true; } catch (e) { return false; } }
  function sameWho(a, b) {
    if (!a || !b || (a.school.code || a.school.name) !== (b.school.code || b.school.name)) return false;
    if (a.gr >= 0) return a.gr === b.gr && a.cl === b.cl && a.no === b.no;   // 같은 학교·학년·반·번호면 같은 사람
    return !!a.name && a.name === b.name;                                    // 예전 학번 정보는 같은 학교·이름이면 이어 써요
  }
  function shortSchool(n) { return String(n).replace(/초등학교$/, '초').replace(/고등학교$/, '고').replace(/중학교$/, '중'); }
  // 다른 도메인의 실험실로 갈 때만 내 정보를 주소 끝에 실어 보내요
  function handoff(href) {
    var m = readMe(), t = testLeft();
    if (!m && !t) return href;
    try {
      var u = new URL(href, location.href);
      if (u.origin === location.origin || u.origin === HOME_ORIGIN) return href;
      var parts = [];
      if (m) parts.push(HASH_KEY + encodeURIComponent(JSON.stringify(m)));
      if (t) parts.push(TEST_HASH + t);   // 테스트 모드도 함께 넘겨요 (끝나는 시각만 담겨요)
      return u.href.split('#')[0] + '#' + parts.join('&');
    } catch (e) { return href; }
  }
  // 입력하고 돌아갈 주소는 우리 실험실 주소일 때만 받아요 (엉뚱한 곳으로 보내지 못하게)
  function allowBack(u) {
    try {
      var x = new URL(u); x.hash = '';
      if (x.protocol !== 'https:') return null;
      if (x.origin === HOME_ORIGIN) return x.href;
      for (var i = 0; i < LABS.length; i++) {
        var l = new URL(LABS[i].href);
        if (x.origin === l.origin && (l.pathname === '/' || x.pathname.indexOf(l.pathname.replace(/\/$/, '')) === 0)) return x.href;
      }
    } catch (e) {}
    return null;
  }
  // 다른 실험실에서 넘겨받은 정보를 저장하고 주소에서 지워요
  function takeHandoff() {
    try {
      var h = location.hash;
      if (h.indexOf('#' + HASH_KEY) !== 0 && h.indexOf('#' + TEST_HASH) !== 0) return;
      var keep = [], meRaw = '', tRaw = '';
      h.slice(1).split('&').forEach(function (p) {   // 우리 값만 꺼내고, 다른 값이 붙어 있었다면 남겨 둬요
        if (p.indexOf(HASH_KEY) === 0) meRaw = p.slice(HASH_KEY.length);
        else if (p.indexOf(TEST_HASH) === 0) tRaw = p.slice(TEST_HASH.length);
        else if (p) keep.push(p);
      });
      history.replaceState(history.state, '', location.pathname + location.search + (keep.length ? '#' + keep.join('&') : ''));
      if (meRaw) { var m = sanitizeMe(JSON.parse(decodeURIComponent(meRaw))); if (m) writeMe(m); }
      var t = Number(tRaw);
      if (t > Date.now() && t <= Date.now() + TEST_MAX) { try { localStorage.setItem(TEST_KEY, String(t)); } catch (e) {} }
    } catch (e) {}
  }
  takeHandoff();

  function changed() { try { window.dispatchEvent(new Event('mtryu:me-changed')); } catch (e) {} }
  // 실험실 쪽 코드가 내 정보를 읽을 때: var me = window.MtryuMe.get();  → 다 있으면 { school, gr, cl, no, name, nick, uid }, 아니면 null
  window.MtryuMe = {
    get: readMe,
    getRaw: rawMe,
    handoff: handoff,
    allowBack: allowBack,
    openDialog: function (opts) { if (onHome) openDialog(opts); },   // 게임이 '학교 다시 고르기'를 열 때 써요
    // 입력창이 저장할 때 써요. uid는 같은 사람이면 그대로 두고, 다른 사람이면 새로 만들어요.
    set: function (m) {
      var c = loose(m); if (!c) return false;
      var prev = rawMe();
      c.uid = (prev && prev.uid && sameWho(prev, c)) ? prev.uid : newUid();
      c = sanitizeMe(c); if (!c || !writeMe(c)) return false;
      changed(); return true;
    },
    clear: function () { try { localStorage.removeItem(ME_KEY); } catch (e) {} changed(); }
  };

  function current() {
    var h = location.hostname, p = location.pathname;
    if (h === 'rumi1542-collab.github.io' && p.indexOf('/mathoperation') === 0) return 'math';
    if (h === 'dataandstat.vercel.app') return 'stat';
    if (h === 'mancala-tutorial.vercel.app') return 'game';
    if (h === 'mtryu-lab.vercel.app' && p.indexOf('/probability') === 0) return 'prob';
    return '';
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function here() { return location.href.split('#')[0]; }
  var onHome = location.origin === HOME_ORIGIN;

  /* ── 접속 집계: 어느 실험실인지, 학교, 익명 번호만 보내요 (이름·학번·별명은 보내지 않아요) ── */
  function unitOf() {
    var h = location.hostname, p = location.pathname;
    if (h.indexOf('dataandstat') === 0) return 'stat';
    if (h.indexOf('mancala') === 0) return 'game';
    if (h.indexOf('github.io') > 0) return 'math';
    if (p.indexOf('/probability/river') === 0) return 'river';
    if (p.indexOf('/probability/coin') === 0) return 'coin';
    if (p.indexOf('/probability/sim') === 0) return 'sim';
    if (p.indexOf('/probability/dalembert') === 0) return 'dalembert';
    if (p.indexOf('/probability/goldfinger') === 0) return 'gold';
    if (p.indexOf('/probability') === 0) return 'prob';
    if (onHome && (p === '/' || p === '/index.html')) return 'home';
    return '';
  }
  function track() {
    try {
      var unit = unitOf(), me = readMe();
      if (!unit || !me || !me.uid || testLeft()) return;   // 테스트 모드에서는 접속을 세지 않아요
      var k = 'mtryu.hit.' + unit, now = Date.now(), last = 0;
      try { last = Number(sessionStorage.getItem(k)) || 0; } catch (e) {}
      if (now - last < 30 * 60 * 1000) return;   // 같은 화면에서는 30분에 한 번만
      try { sessionStorage.setItem(k, String(now)); } catch (e) {}
      fetch(HOME + 'api/hit', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, keepalive: true,
        body: JSON.stringify({ unit: unit, code: (me.school && me.school.code) || '', name: (me.school && me.school.name) || '', uid: me.uid }) }).catch(function () {});
    } catch (e) {}
  }

  /* ── 입력창 (me-dialog.js)는 메인과 같은 주소의 페이지에서만 열어요 ── */
  function openDialog(opts) {
    function go() { window.MtryuMeDialog.open(opts || {}); }
    if (window.MtryuMeDialog) return go();
    var s = document.createElement('script');
    s.src = HOME + 'me-dialog.js';
    s.onload = go;
    s.onerror = function () {
      showGate({ title: '입력창을 불러오지 못했어요', text: '인터넷 연결을 확인하고 다시 해 주세요.', label: '다시 불러오기', reload: true });
    };
    document.head.appendChild(s);
  }

  /* ── 필수 입력 막: 내 정보가 없으면 입력할 때까지 아무것도 못 해요 ── */
  function showGate(o) {
    var old = document.getElementById('mtryu-gate'); if (old) old.remove();
    var host = document.createElement('div');
    host.id = 'mtryu-gate';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483600;margin:0;padding:0;';
    var root = host.attachShadow({ mode: 'open' });
    root.innerHTML =
      '<style>:host{all:initial}*{box-sizing:border-box}' +
      '.ov{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(43,15,63,.82);' +
        "font-family:'Noto Sans KR','Malgun Gothic','Apple SD Gothic Neo',system-ui,sans-serif;color:#2B0F3F}" +
      '.box{width:100%;max-width:420px;display:flex;flex-direction:column;gap:14px;background:#fff;border:2px solid #2B0F3F;border-radius:16px;padding:24px;box-shadow:6px 6px 0 #D81B7A}' +
      'h2{margin:0;font-size:22px;font-weight:900}p{margin:0;font-size:15px;line-height:1.6;color:#5A4670}' +
      'a,button{display:flex;align-items:center;justify-content:center;min-height:48px;border:0;border-radius:10px;background:#7719AA;color:#fff;font:inherit;font-size:16px;font-weight:700;text-decoration:none;cursor:pointer}' +
      'a:focus-visible,button:focus-visible{outline:3px solid #FF2D95;outline-offset:2px}</style>' +
      '<div class="ov" role="alertdialog" aria-modal="true" aria-labelledby="t"><div class="box"><h2 id="t">' + esc(o.title) + '</h2><p>' + esc(o.text) + '</p>' +
      (o.reload ? '<button type="button" id="b">' + esc(o.label) + '</button>' : '<a id="b" href="' + esc(o.href) + '">' + esc(o.label) + '</a>') + '</div></div>';
    var b = root.getElementById ? root.getElementById('b') : root.querySelector('#b');
    if (o.reload) b.addEventListener('click', function () { location.reload(); });
    document.body.appendChild(host);
    try { b.focus(); } catch (e) {}
  }
  function removeGate() { var g = document.getElementById('mtryu-gate'); if (g) g.remove(); }
  function enforce() {
    if (readMe()) { removeGate(); return; }
    if (document.body && document.body.classList.contains('capture')) return;   // 화면 캡처용 보기에서는 막지 않아요
    if (onHome) {
      var qs = new URLSearchParams(location.search);
      var back = allowBack(qs.get('back'));
      if (qs.has('me') || qs.has('back')) { try { history.replaceState(history.state, '', location.pathname + location.hash); } catch (e) {} }
      openDialog({ required: true, back: back });
    } else {
      showGate({
        title: '먼저 내 정보를 입력해 주세요',
        text: '학교·학년·반·번호·이름·별명을 한 번만 입력하면 모든 실험실에서 다시 쓰지 않아도 돼요. 입력이 끝나면 지금 보던 곳으로 돌아와요.',
        label: '내 정보 입력하러 가기', href: HOME + '?me=1&back=' + encodeURIComponent(here())
      });
    }
  }

  function build() {
    if (document.getElementById('mtryu-labbar')) return;
    var cur = current();

    // 페이지 전체를 바 높이만큼 아래로 내려요 (고정 높이 화면은 var(--labbar-h)를 써서 맞춰요)
    var st = document.createElement('style');
    st.id = 'mtryu-labbar-style';
    st.textContent =
      ':root{--labbar-h:calc(40px + env(safe-area-inset-top,0px))}' +
      'html{padding-top:var(--labbar-h);scroll-padding-top:var(--labbar-h)}' +
      '@media print{#mtryu-labbar,#mtryu-gate{display:none!important}html{padding-top:0!important}}' +
      'html:has(body.capture){padding-top:0!important}body.capture #mtryu-labbar{display:none!important}';
    document.head.appendChild(st);

    var host = document.createElement('div');
    host.id = 'mtryu-labbar';
    host.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483000;margin:0;padding:0;';
    var root = host.attachShadow({ mode: 'open' });

    var links = LABS.map(function (l) {
      return '<a class="nav' + (l.id === cur ? ' on' : '') + '" data-base="' + esc(l.href) + '" href="' + esc(handoff(l.href)) + '"' + (l.id === cur ? ' aria-current="page"' : '') + '>' + esc(l.name) + '</a>';
    }).join('');
    var menu = '<a class="mi" href="' + HOME + '">첫 화면</a>' + LABS.map(function (l) {
      return '<a class="mi' + (l.id === cur ? ' on' : '') + '" data-base="' + esc(l.href) + '" href="' + esc(handoff(l.href)) + '">' + esc(l.name) + '</a>';
    }).join('');
    function meHref() { return onHome ? HOME + '?me=1' : HOME + '?me=1&back=' + encodeURIComponent(here()); }
    function testHTML() {
      return testLeft() ? '<a class="tst" href="' + HOME + 'admin/" title="테스트 모드: 서버에 저장하지 않아요. 눌러서 관리자 화면에서 끌 수 있어요">🧪 테스트</a>' : '';
    }
    function tagHTML() {
      var m = readMe();
      if (!m) return '<a class="me empty" href="' + esc(meHref()) + '" title="학교·학년·반·번호·이름·별명을 한 번만 적어 두세요">이름 입력</a>';
      return '<a class="me" href="' + esc(meHref()) + '" title="별명: ' + esc(m.nick) + ' · 눌러서 내 정보 바꾸기" aria-label="내 정보 ' + esc(m.school.name) + ' ' + esc(m.gr + '학년 ' + m.cl + '반 ' + m.no + '번') + ' ' + esc(m.name) + ', 별명 ' + esc(m.nick) + '. 눌러서 바꾸기">' +
        '<span class="sc">' + esc(shortSchool(m.school.name)) + '</span><span class="id">' + esc(m.gr + '-' + m.cl + '-' + m.no) + '</span><span class="nm">' + esc(m.name) + '</span></a>';
    }

    root.innerHTML =
      '<style>' +
      ':host{all:initial}' +
      '*{box-sizing:border-box}' +
      '.bar{display:flex;align-items:center;justify-content:space-between;gap:12px;height:calc(40px + env(safe-area-inset-top,0px));' +
        'padding:env(safe-area-inset-top,0px) max(12px,env(safe-area-inset-right,0px)) 0 max(12px,env(safe-area-inset-left,0px));' +
        'background:linear-gradient(90deg,#2B0F3F,#4A1573);color:#fff;border-bottom:2px solid #D81B7A;' +
        "font-family:'Noto Sans KR','Malgun Gothic','Apple SD Gothic Neo',system-ui,sans-serif;font-size:14px;line-height:1}" +
      'a{color:inherit;text-decoration:none}' +
      '.brand{display:flex;align-items:center;gap:8px;min-width:0;height:32px;padding:0 6px;border-radius:8px;font-weight:900;font-size:15px;white-space:nowrap}' +
      '.brand img{width:24px;height:24px;display:block}' +
      '.brand:hover,.nav:hover,.mi:hover{background:rgba(255,255,255,.14)}' +
      'nav{display:flex;gap:4px;align-items:center}' +
      '.nav{display:inline-flex;align-items:center;height:30px;padding:0 12px;border-radius:999px;font-weight:700;white-space:nowrap;color:#EBDDF6}' +
      '.nav.on{background:#fff;color:#4A1573}' +
      '.nav.on:hover{background:#fff}' +
      '.btn{display:none;align-items:center;flex:none;height:30px;padding:0 12px;border:0;border-radius:999px;background:rgba(255,255,255,.16);color:#fff;font:inherit;font-weight:700;white-space:nowrap;cursor:pointer}' +
      '.panel{display:none;position:absolute;top:100%;right:max(8px,env(safe-area-inset-right,0px));min-width:200px;margin-top:6px;padding:6px;border-radius:12px;background:#2B0F3F;box-shadow:0 10px 30px rgba(0,0,0,.35)}' +
      '.panel.open{display:block}' +
      '.mi{display:flex;align-items:center;height:40px;padding:0 12px;border-radius:8px;color:#fff;font-size:15px;font-weight:500}' +
      '.mi.on{background:#fff;color:#4A1573;font-weight:700}' +
      'a:focus-visible,.btn:focus-visible{outline:2px solid #FF8AC8;outline-offset:2px}' +
      '.right{display:flex;align-items:center;gap:6px;min-width:0}' +
      '#me-slot{display:flex;min-width:0}' +
      '.me{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;border-radius:999px;background:rgba(255,255,255,.16);font-weight:700;white-space:nowrap;max-width:48vw;overflow:hidden}' +
      '.me:hover{background:rgba(255,255,255,.26)}' +
      '.me .sc,.me .id{font-weight:500;color:#EBDDF6}' +
      '.me .nm{overflow:hidden;text-overflow:ellipsis}' +
      '.tst{display:inline-flex;align-items:center;height:30px;padding:0 10px;margin-right:6px;border-radius:999px;background:#FFC53D;color:#3B2A00;font-weight:900;white-space:nowrap}' +
      '#me-slot{align-items:center}' +
      '.me.empty{background:transparent;border:1.5px dashed rgba(255,255,255,.6);color:#EBDDF6;font-weight:500}' +
      '.me.empty:hover{background:rgba(255,255,255,.14)}' +
      '@media (max-width:720px){nav{display:none}.btn{display:inline-flex}.brand span{max-width:26vw;overflow:hidden;text-overflow:ellipsis}.me{max-width:38vw;padding:0 10px}.me .sc{display:none}}' +
      '</style>' +
      '<div class="bar" role="navigation" aria-label="MT RYU의 수학 실험실">' +
        '<a class="brand" href="' + HOME + '" title="실험실 첫 화면으로"><img src="' + HOME + 'favicon.svg" alt=""><span>MT RYU의 수학 실험실</span></a>' +
        '<nav>' + links + '</nav>' +
        '<div class="right"><span id="me-slot">' + testHTML() + tagHTML() + '</span>' +
        '<button class="btn" type="button" aria-expanded="false" aria-controls="panel">실험실 ▾</button></div>' +
      '</div>' +
      '<div class="panel" id="panel">' + menu + '</div>';

    var img = root.querySelector('.brand img');
    img.addEventListener('error', function () { img.style.display = 'none'; });

    var btn = root.querySelector('.btn'), panel = root.getElementById ? root.getElementById('panel') : root.querySelector('#panel');
    function setOpen(o) { panel.classList.toggle('open', o); btn.setAttribute('aria-expanded', o ? 'true' : 'false'); }
    btn.addEventListener('click', function (e) { e.stopPropagation(); setOpen(!panel.classList.contains('open')); });
    document.addEventListener('click', function () { setOpen(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setOpen(false); });

    root.addEventListener('click', function (e) {
      var a = e.target.closest ? e.target.closest('a') : null;
      if (!a) return;
      // 이름표: 메인과 같은 주소의 페이지에서는 그 자리에서 입력창을 열어요 (게임 화면이 그대로 있어요)
      if (a.classList.contains('me') && onHome) { e.preventDefault(); setOpen(false); openDialog({ required: false }); return; }
      // 이동하기 전에 페이지에 알려요. 페이지가 preventDefault()하면 이동하지 않아요. (예: 게임 도중 확인창)
      var ev = new CustomEvent('labbar:navigate', { cancelable: true, detail: { href: a.href } });
      if (!window.dispatchEvent(ev)) e.preventDefault();
    });

    // 내 정보가 바뀌면(저장·삭제·다른 탭) 이름표와 이동 주소를 다시 만들고, 막이 떠 있었다면 걷어요
    var slot = root.querySelector('#me-slot');
    function refresh() {
      slot.innerHTML = testHTML() + tagHTML();
      var as = root.querySelectorAll('a[data-base]');
      for (var i = 0; i < as.length; i++) as[i].href = handoff(as[i].getAttribute('data-base'));
      if (readMe()) removeGate(); else enforce();   // 정보를 지우면 곧바로 다시 입력하게 해요 (공용 컴퓨터에서 다음 학생 차례)
    }
    window.addEventListener('mtryu:me-changed', function () { refresh(); track(); });
    window.addEventListener('storage', function (e) { if (e.key === ME_KEY || e.key === null) { refresh(); if (!readMe()) enforce(); else track(); } else if (e.key === TEST_KEY) refresh(); });

    document.body.insertBefore(host, document.body.firstChild);
    enforce();
    track();
  }

  if (document.body) build(); else document.addEventListener('DOMContentLoaded', build);
})();
