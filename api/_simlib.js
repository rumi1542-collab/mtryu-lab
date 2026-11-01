// 확률 실험 시뮬레이터 도구 (파일 이름이 _로 시작하면 Vercel이 따로 주소를 만들지 않아요)
// 값 검사와 난수 던지기를 모아 둔 곳이에요. api/sim.js가 불러 써요.
const crypto = require('crypto');

const MIN_CASES = 2;
const MAX_CASES = 8;
const MAX_ROLL = 10000;       // n번 던지기 한 번에 던질 수 있는 최대 횟수
const MAX_REP_N = 1000;       // n번씩 k회 반복하기에서 한 회에 던지는 최대 횟수
const MAX_REP_K = 1000;       // 반복 횟수
const MAX_REP_TOTAL = 200000; // n × k 전체 상한 (서버가 한 번에 던지는 총량)

// 글자 다듬기: 제어문자와 < > 를 없애고, 연속 공백은 하나로
function cleanText(s, max) {
  return String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

// 올릴 실험 한 개를 검사해서 { tool, cases, p } 로 돌려줘요. 못 받는 값이면 null.
//   p는 합이 1이 되도록 맞춘 확률이에요 (화면에서 상대도수의 합이 1에 가깝게 쓰도록 이미 확인하지만 서버도 다시 확인해요)
function buildExperiment(b, badName) {
  if (!b || typeof b !== 'object') return null;
  const tool = cleanText(b.tool, 16);
  if (!tool || badName(tool)) return null;
  const cases = Array.isArray(b.cases) ? b.cases.map(x => cleanText(x, 12)) : null;
  const w = Array.isArray(b.w) ? b.w.map(Number) : null;
  if (!cases || !w || cases.length !== w.length) return null;
  if (cases.length < MIN_CASES || cases.length > MAX_CASES) return null;
  if (cases.some(c => !c || badName(c))) return null;
  if (new Set(cases).size !== cases.length) return null;                 // 같은 이름의 경우가 둘이면 결과를 읽을 수 없어요
  if (w.some(x => !Number.isFinite(x) || x <= 0 || x > 1e6)) return null;
  const sum = w.reduce((a, c) => a + c, 0);
  const p = w.map(x => x / sum);
  return { tool, cases, p };
}

// 모든 경우의 확률이 같은지 (판정의 정답이에요. 밖으로는 내보내지 않아요)
function isEqual(p) {
  const mx = Math.max.apply(null, p), mn = Math.min.apply(null, p);
  return mx - mn <= 1e-9 * mx;
}

// 확률 p로 count번 던져서 경우 번호(0부터)의 배열을 돌려줘요. 브라우저의 것과 같은 암호용 난수를 써요.
function roll(p, count) {
  const cum = [];
  let acc = 0;
  for (let i = 0; i < p.length; i++) { acc += p[i]; cum.push(acc); }
  cum[cum.length - 1] = Infinity;   // 부동소수점 오차로 마지막 경우가 빠지는 일이 없게
  const rnd = new Uint32Array(count);
  crypto.randomFillSync(rnd);
  const out = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const u = rnd[i] / 4294967296;
    let k = 0;
    while (u >= cum[k]) k++;
    out[i] = k;
  }
  return out;
}

// n번씩 k회: 경우 pick이 한 회(n번)마다 몇 번 나왔는지 k개의 도수를 돌려줘요
function rollRep(p, n, k, pick) {
  const all = roll(p, n * k);
  const counts = new Array(k).fill(0);
  for (let r = 0; r < k; r++) {
    let c = 0;
    const base = r * n;
    for (let i = 0; i < n; i++) if (all[base + i] === pick) c++;
    counts[r] = c;
  }
  return counts;
}

const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

module.exports = { MIN_CASES, MAX_CASES, MAX_ROLL, MAX_REP_N, MAX_REP_K, MAX_REP_TOTAL, cleanText, buildExperiment, isEqual, roll, rollRep, isInt };
