// 동전 실험실 계산 도구 (probability/coin/index.html 의 계산과 같은 식이에요. 둘을 같이 고쳐 주세요)
// 파일 이름이 _로 시작하면 Vercel이 따로 주소를 만들지 않아요

const MAXRUN = 30;      // 연속 맞추기 최대 횟수
const FLIPS = 1000;     // 상대도수 줄타기에서 던지는 횟수
const SPOT_ROUNDS = 8;  // 동전 조작 탐정 연습하기 문제 수 (순위에 올리는 '시작하기'는 끝없이, 3번 틀리면 끝)
const LIVES = 3;        // 시작하기에서 틀려도 되는 횟수 + 1 (3번 틀리면 끝)
const ENDLESS_MAX = 300; // 시작하기에서 맞힐 수 있는 개수의 상한 (이상한 값 막기)

function hexToBits(h) {
  const o = new Uint8Array(h.length * 4);
  for (let i = 0; i < h.length; i++) {
    const v = parseInt(h[i], 16);
    o[4 * i] = (v >> 3) & 1; o[4 * i + 1] = (v >> 2) & 1; o[4 * i + 2] = (v >> 1) & 1; o[4 * i + 3] = v & 1;
  }
  return o;
}

// 던진 횟수 n에서 앞면 비율이 0.5±w% 밖이었던 마지막 때 + 1 (끝까지 못 들어오면 1001)
function settleTime(bits, w) {
  let heads = 0, last = 0;
  for (let i = 0; i < bits.length; i++) {
    heads += bits[i];
    const n = i + 1;
    if (Math.abs(2 * heads - n) * 100 > 2 * w * n) last = n;
  }
  return last + 1;
}

const LN = [0]; for (let i = 1; i <= 1000; i++) LN[i] = LN[i - 1] + Math.log(i);
function pmf(n, k) { return Math.exp(LN[n] - LN[k] - LN[n - k] - n * Math.LN2); }
function probRange(n, lo, hi) { let s = 0; for (let k = lo; k <= hi; k++) s += pmf(n, k); return Math.min(1, s); }

// 내기 시뮬레이터 문제 (n: 던지는 횟수, lo~hi: 성공하는 앞면 수)
const BET = [
  { small: { n: 10,  lo: 7,  hi: 10 }, big: { n: 1000, lo: 700, hi: 1000 } },
  { small: { n: 20,  lo: 12, hi: 20 }, big: { n: 200,  lo: 120, hi: 200 } },
  { small: { n: 10,  lo: 5,  hi: 5  }, big: { n: 1000, lo: 500, hi: 500 } },
  { small: { n: 10,  lo: 4,  hi: 6  }, big: { n: 1000, lo: 400, hi: 600 } },
  { small: { n: 100, lo: 45, hi: 55 }, big: { n: 1000, lo: 450, hi: 550 } },
  { small: { n: 4,   lo: 3,  hi: 4  }, big: { n: 40,   lo: 30, hi: 40 } },
  { small: { n: 5,   lo: 4,  hi: 5  }, big: { n: 50,   lo: 40, hi: 50 } },
  { small: { n: 20,  lo: 13, hi: 20 }, big: { n: 200,  lo: 130, hi: 200 } },
  { small: { n: 2,   lo: 1,  hi: 1  }, big: { n: 200,  lo: 100, hi: 100 } },
  { small: { n: 10,  lo: 3,  hi: 7  }, big: { n: 100,  lo: 30, hi: 70 } },
  { small: { n: 20,  lo: 9,  hi: 11 }, big: { n: 500,  lo: 225, hi: 275 } },
  { small: { n: 10,  lo: 0,  hi: 4  }, big: { n: 1000, lo: 0,  hi: 400 } },
  { small: { n: 5,   lo: 0,  hi: 0  }, big: { n: 50,   lo: 0,  hi: 0 } },
  { small: { n: 10,  lo: 9,  hi: 10 }, big: { n: 100,  lo: 90, hi: 100 } },
  { small: { n: 100, lo: 55, hi: 100 }, big: { n: 1000, lo: 550, hi: 1000 } }
];
function betRound(r) {
  const R = BET[r.i], a = r.f ? R.small : R.big, b = r.f ? R.big : R.small;
  const pA = probRange(a.n, a.lo, a.hi), pB = probRange(b.n, b.lo, b.hi);
  const ok = (r.p === 'A') === (pA > pB);
  const e = Math.abs(r.e - pA * 100);
  const pts = (ok ? 10 : 0) + Math.round(10 * Math.max(0, 1 - e / 30));
  return { pA, pB, ok, pts };
}

module.exports = { LIVES, ENDLESS_MAX, MAXRUN, FLIPS, SPOT_ROUNDS, BET, hexToBits, settleTime, betRound, probRange };
