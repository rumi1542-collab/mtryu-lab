/* 내 정보(학교·학번·이름)를 순위 저장이 있는 게임(강 건너기·동전 실험실)에 자동으로 맞춰 줘요.
   메인 페이지에서 정보를 새로 저장하면, 게임이 처음 열릴 때 한 번만 학교와 이름을 채워 줘요.
   그 뒤에 게임 안에서 학교나 이름을 직접 바꾸면 그대로 두고, 메인에서 정보를 또 바꿀 때만 다시 맞춰요.
   게임 쪽 사용법:  var r = await MtryuMeSync.apply('rd_mesig', LIST.schools, LIST.regions, '/api/config');
                    (r가 null이면 할 일이 없어요)  →  다 맞춘 뒤 MtryuMeSync.done('rd_mesig', r)
   저장 키 'mtryu.me'는 lab-bar.js·index.html과 같아요. */
(function () {
  'use strict';
  var ME_KEY = 'mtryu.me';

  function read() {
    try {
      var m = JSON.parse(localStorage.getItem(ME_KEY));
      if (m && m.school && m.school.name && m.sid && m.name) return m;
    } catch (e) {}
    return null;
  }
  function sig(m) { return [m.school.code || m.school.name, m.sid, m.name].join('|'); }

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

  // 이 게임이 아직 맞춰 보지 않은 새 정보가 있으면 { me, label, list, sig, retry } 를 돌려줘요. 없으면 null.
  //   label: 순위표 학교 이름 (못 찾으면 null)   list: 학교를 새로 추가했을 때 서버가 돌려준 최신 목록
  //   retry: 학교를 추가하다가 잠깐 막혔다는 뜻이에요 (다음에 다시 시도해요)
  function apply(storeKey, schools, regions, configUrl) {
    var m = read();
    if (!m) return Promise.resolve(null);
    var s = sig(m), prev = '';
    try { prev = localStorage.getItem(storeKey) || ''; } catch (e) {}
    if (prev === s) return Promise.resolve(null);
    var label = findLabel(m, schools || [], regions);
    if (label || !m.school.region || !m.school.code) {   // 찾았거나, 나이스에서 고른 학교가 아니라 추가할 수 없는 경우
      return Promise.resolve({ me: m, label: label, list: null, sig: s, retry: false });
    }
    return postAdd(configUrl, m.school.name, m.school.region).then(function (j) {
      return { me: m, label: (j && j.added) || null, list: j || null, sig: s, retry: false };
    }, function (e) {
      return { me: m, label: null, list: null, sig: s, retry: e && e.status !== 400 };   // 400은 다시 해도 안 되는 경우
    });
  }
  function done(storeKey, r) {
    if (!r || r.retry) return;
    try { localStorage.setItem(storeKey, r.sig); } catch (e) {}
  }

  window.MtryuMeSync = { read: read, apply: apply, done: done };
})();
