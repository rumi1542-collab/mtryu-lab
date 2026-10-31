/* MT RYU의 실험실 · 공통 상단 바
   모든 실험실 페이지의 <head>에 이 한 줄만 넣으면 맨 위에 항상 보이는 바가 생겨요.
     <script src="https://mtryu-lab.vercel.app/lab-bar.js" defer></script>
   실험실이 늘어나면 아래 LABS 목록만 고치면 모든 페이지에 한꺼번에 반영돼요. */
(function () {
  'use strict';
  if (window.__mtryuLabBar || window.top !== window.self) return;   // 중복 실행·iframe 안에서는 만들지 않아요
  window.__mtryuLabBar = true;

  var HOME = 'https://mtryu-lab.vercel.app/';
  var LABS = [
    { id: 'math', name: '수학 실험실',      href: 'https://rumi1542-collab.github.io/mathoperation/' },
    { id: 'stat', name: '통계 실험실',      href: 'https://dataandstat.vercel.app/' },
    { id: 'prob', name: '확률 실험실',      href: 'https://mtryu-lab.vercel.app/probability/' },
    { id: 'game', name: '게임 수학 실험실', href: 'https://mancala-tutorial.vercel.app/' }
  ];

  /* ── 내 정보(학교·학번·이름) ──────────────────────────────────────────
     메인 페이지에서 한 번 입력하면 이 브라우저(localStorage 'mtryu.me')에만 저장돼요. 서버로는 보내지 않아요.
     다른 주소(도메인)의 실험실로 넘어갈 때는 주소 끝에 #mtryu-me=... 를 붙여 건네고, 받는 쪽이 저장한 뒤 바로 지워요.
     index.html 안에도 같은 키·같은 검사 규칙이 있으니 고칠 때 함께 고쳐 주세요. */
  var ME_KEY = 'mtryu.me', HASH_KEY = 'mtryu-me=', HOME_ORIGIN = new URL(HOME).origin;
  function clean(s, n) { return String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n); }
  function sanitizeMe(m) {
    if (!m || typeof m !== 'object') return null;
    var sc = m.school && typeof m.school === 'object' ? m.school : {};
    var out = {
      v: 1,
      school: { name: clean(sc.name, 40), region: clean(sc.region, 20), code: clean(sc.code, 20), edu: clean(sc.edu, 10) },
      sid: clean(m.sid, 8).replace(/\D/g, ''),
      name: clean(m.name, 8)
    };
    return out.school.name && out.sid && out.name ? out : null;
  }
  function readMe() { try { return sanitizeMe(JSON.parse(localStorage.getItem(ME_KEY))); } catch (e) { return null; } }
  function writeMe(m) { try { localStorage.setItem(ME_KEY, JSON.stringify(m)); return true; } catch (e) { return false; } }
  function shortSchool(n) { return String(n).replace(/초등학교$/, '초').replace(/고등학교$/, '고').replace(/중학교$/, '중'); }
  // 다른 도메인의 실험실로 갈 때만 내 정보를 주소 끝에 실어 보내요
  function handoff(href) {
    var m = readMe();
    if (!m) return href;
    try {
      var u = new URL(href, location.href);
      if (u.origin === location.origin || u.origin === HOME_ORIGIN) return href;
      return u.href.split('#')[0] + '#' + HASH_KEY + encodeURIComponent(JSON.stringify(m));
    } catch (e) { return href; }
  }
  // 다른 실험실에서 넘겨받은 정보를 저장하고 주소에서 지워요
  function takeHandoff() {
    try {
      var h = location.hash;
      if (h.indexOf('#' + HASH_KEY) !== 0) return;
      var raw = h.slice(HASH_KEY.length + 1).split('&')[0];
      var rest = h.slice(HASH_KEY.length + 1 + raw.length);   // 뒤에 다른 값이 붙어 있었다면 남겨 둬요
      history.replaceState(history.state, '', location.pathname + location.search + (rest.charAt(0) === '&' ? '#' + rest.slice(1) : ''));
      var m = sanitizeMe(JSON.parse(decodeURIComponent(raw)));
      if (m) writeMe(m);
    } catch (e) {}
  }
  takeHandoff();

  function current() {
    var h = location.hostname, p = location.pathname;
    if (h === 'rumi1542-collab.github.io' && p.indexOf('/mathoperation') === 0) return 'math';
    if (h === 'dataandstat.vercel.app') return 'stat';
    if (h === 'mancala-tutorial.vercel.app') return 'game';
    if (h === 'mtryu-lab.vercel.app' && p.indexOf('/probability') === 0) return 'prob';
    return '';
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function build() {
    if (document.getElementById('mtryu-labbar')) return;
    var cur = current();

    // 페이지 전체를 바 높이만큼 아래로 내려요 (고정 높이 화면은 var(--labbar-h)를 써서 맞춰요)
    var st = document.createElement('style');
    st.id = 'mtryu-labbar-style';
    st.textContent =
      ':root{--labbar-h:calc(40px + env(safe-area-inset-top,0px))}' +
      'html{padding-top:var(--labbar-h);scroll-padding-top:var(--labbar-h)}' +
      '@media print{#mtryu-labbar{display:none!important}html{padding-top:0!important}}' +
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
    function tagHTML() {
      var m = readMe();
      if (!m) return '<a class="me empty" href="' + HOME + '?me=1" title="학교·학번·이름을 한 번만 적어 두세요">이름 입력</a>';
      return '<a class="me" href="' + HOME + '?me=1" title="내 정보 바꾸기" aria-label="내 정보 ' + esc(m.school.name) + ' ' + esc(m.sid) + ' ' + esc(m.name) + ', 눌러서 바꾸기">' +
        '<span class="sc">' + esc(shortSchool(m.school.name)) + '</span><span class="id">' + esc(m.sid) + '</span><span class="nm">' + esc(m.name) + '</span></a>';
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
      '.me.empty{background:transparent;border:1.5px dashed rgba(255,255,255,.6);color:#EBDDF6;font-weight:500}' +
      '.me.empty:hover{background:rgba(255,255,255,.14)}' +
      '@media (max-width:720px){nav{display:none}.btn{display:inline-flex}.brand span{max-width:26vw;overflow:hidden;text-overflow:ellipsis}.me{max-width:38vw;padding:0 10px}.me .sc{display:none}}' +
      '</style>' +
      '<div class="bar" role="navigation" aria-label="MT RYU의 실험실">' +
        '<a class="brand" href="' + HOME + '" title="실험실 첫 화면으로"><img src="' + HOME + 'favicon.svg" alt=""><span>MT RYU의 실험실</span></a>' +
        '<nav>' + links + '</nav>' +
        '<div class="right"><span id="me-slot">' + tagHTML() + '</span>' +
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

    // 이동하기 전에 페이지에 알려요. 페이지가 preventDefault()하면 이동하지 않아요. (예: 게임 도중 확인창)
    root.addEventListener('click', function (e) {
      var a = e.target.closest ? e.target.closest('a') : null;
      if (!a) return;
      var ev = new CustomEvent('labbar:navigate', { cancelable: true, detail: { href: a.href } });
      if (!window.dispatchEvent(ev)) e.preventDefault();
    });

    // 내 정보가 바뀌면(메인에서 저장·삭제하거나 다른 탭에서 바꾸면) 이름표와 이동 주소를 다시 만들어요
    var slot = root.querySelector('#me-slot');
    function refresh() {
      slot.innerHTML = tagHTML();
      var as = root.querySelectorAll('a[data-base]');
      for (var i = 0; i < as.length; i++) as[i].href = handoff(as[i].getAttribute('data-base'));
    }
    window.addEventListener('mtryu:me-changed', refresh);
    window.addEventListener('storage', function (e) { if (e.key === ME_KEY || e.key === null) refresh(); });

    document.body.insertBefore(host, document.body.firstChild);
  }

  // 실험실 쪽 코드가 내 정보를 읽을 때: var me = window.MtryuMe.get();  → { school:{name,region,code}, sid, name } 또는 null
  window.MtryuMe = {
    get: readMe,
    set: function (m) { var c = sanitizeMe(m); if (!c || !writeMe(c)) return false; window.dispatchEvent(new Event('mtryu:me-changed')); return true; },
    clear: function () { try { localStorage.removeItem(ME_KEY); } catch (e) {} window.dispatchEvent(new Event('mtryu:me-changed')); }
  };

  if (document.body) build(); else document.addEventListener('DOMContentLoaded', build);
})();
