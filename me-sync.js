/* 순위가 있는 게임(강 건너기·동전 실험실)이 내 정보를 읽고, 내 학교를 순위 서버 목록에 맞출 때 쓰는 도구예요.
   게임 페이지의 <head>에서 lab-bar.js보다 먼저(defer 없이) 불러와요.   <script src="/me-sync.js"></script>

     var m = MtryuMeSync.read();                      // { school, gr, cl, no, name, nick, uid } 또는 null (다 있을 때만)
     var r = await MtryuMeSync.resolve(schools, regions, '/api/config');
         // → { me, label, list, retry }   label: 순위 서버에 있는 내 학교 이름 (없으면 null)
         //   list: 학교를 새로 추가했을 때 서버가 돌려준 최신 목록   retry: 잠깐 막힌 것이라 다시 하면 될 수도 있다는 뜻
     MtryuMeSync.block({...}) / unblock()             // 내 학교를 순위 서버에 올리지 못할 때 게임을 막는 안내창
     MtryuMeSync.watch(fn)                            // 내 정보가 바뀌면(이름표에서 바꾸면) fn을 불러요
   내 정보를 저장하고 입력창을 여는 일은 lab-bar.js(window.MtryuMe)가 해요. 저장 키 'mtryu.me'는 같아요. */
(function () {
  'use strict';
  var ME_KEY = 'mtryu.me';

  function read() {
    try {
      var m = JSON.parse(localStorage.getItem(ME_KEY));
      if (m && m.school && m.school.name && Number.isInteger(m.gr) && m.gr >= 0 && Number.isInteger(m.cl) && m.cl >= 0 && Number.isInteger(m.no) && m.no >= 0 && m.name && m.nick && /^[a-f0-9]{32}$/.test(m.uid || '')) return m;
    } catch (e) {}
    return null;
  }

  // 순위표 학교 목록에서 내 학교를 찾아요 (같은 이름의 다른 지역 학교는 '이름(지역)'으로 들어 있어요)
  function findLabel(m, schools, regions) {
    regions = regions || {};
    var n = m.school.name, r = m.school.region || '';
    if (schools.indexOf(n) >= 0 && (!regions[n] || !r || regions[n] === r)) return n;
    var alt = (n + '(' + r + ')').slice(0, 20);
    if (r && schools.indexOf(alt) >= 0) return alt;
    return null;
  }

  function postAdd(url, name, region) {
    var ctl = 'AbortController' in window ? new AbortController() : null;
    var t = setTimeout(function () { if (ctl) ctl.abort(); }, 10000);
    return fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ add: { name: name, region: region } }), signal: ctl ? ctl.signal : undefined
    }).then(function (r) {
      clearTimeout(t);
      if (!r.ok) { var er = new Error('http ' + r.status); er.status = r.status; throw er; }
      return r.json();
    }, function (e) { clearTimeout(t); throw e; });
  }

  function resolve(schools, regions, configUrl) {
    var m = read();
    if (!m) return Promise.resolve(null);
    var label = findLabel(m, schools || [], regions);
    if (label) return Promise.resolve({ me: m, label: label, list: null, retry: false });
    // 테스트 모드(관리자 화면에서 켜요): 순위 서버의 학교 목록에는 아무것도 추가하지 않아요
    try { if (Number(localStorage.getItem('mtryu.test')) > Date.now()) return Promise.resolve({ me: m, label: m.school.name, list: null, retry: false }); } catch (e) {}
    // 나이스에서 고른 학교(학교 코드·지역이 있는 경우)만 순위 서버에 추가할 수 있어요
    if (!m.school.region || !m.school.code) return Promise.resolve({ me: m, label: null, list: null, retry: false, manual: true });
    return postAdd(configUrl, m.school.name, m.school.region).then(function (j) {
      return { me: m, label: (j && j.added) || null, list: j || null, retry: false };
    }, function (e) {
      return { me: m, label: null, list: null, retry: !(e && e.status === 400) };   // 400은 다시 해도 안 되는 경우
    });
  }

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function unblock() { var g = document.getElementById('mtryu-block'); if (g) g.remove(); }
  // o: { title, text, label, onClick }  — 닫을 수 없는 안내창
  function block(o) {
    unblock();
    var host = document.createElement('div');
    host.id = 'mtryu-block';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483400;margin:0;padding:0;';
    var root = host.attachShadow({ mode: 'open' });
    root.innerHTML =
      '<style>:host{all:initial}*{box-sizing:border-box}' +
      ".ov{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(43,15,63,.82);font-family:'Noto Sans KR','Malgun Gothic','Apple SD Gothic Neo',system-ui,sans-serif;color:#2B0F3F}" +
      '.box{width:100%;max-width:420px;display:flex;flex-direction:column;gap:14px;background:#fff;border:2px solid #2B0F3F;border-radius:16px;padding:24px;box-shadow:6px 6px 0 #D81B7A}' +
      'h2{margin:0;font-size:22px;font-weight:900}p{margin:0;font-size:15px;line-height:1.6;color:#5A4670}' +
      'button{min-height:48px;border:0;border-radius:10px;background:#7719AA;color:#fff;font:inherit;font-size:16px;font-weight:700;cursor:pointer}' +
      'button:focus-visible{outline:3px solid #FF2D95;outline-offset:2px}</style>' +
      '<div class="ov" role="alertdialog" aria-modal="true" aria-labelledby="t"><div class="box"><h2 id="t">' + esc(o.title) + '</h2><p>' + esc(o.text) + '</p><button type="button" id="b">' + esc(o.label) + '</button></div></div>';
    var b = root.getElementById ? root.getElementById('b') : root.querySelector('#b');
    b.addEventListener('click', o.onClick);
    document.body.appendChild(host);
    try { b.focus(); } catch (e) {}
  }

  function watch(fn) {
    window.addEventListener('mtryu:me-changed', fn);
    window.addEventListener('storage', function (e) { if (e.key === ME_KEY || e.key === null) fn(); });
  }

  window.MtryuMeSync = { read: read, resolve: resolve, block: block, unblock: unblock, watch: watch };
})();
