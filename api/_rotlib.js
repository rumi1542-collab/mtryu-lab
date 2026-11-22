// 나만의 회전체 도형 검사·비교 (화면 geometry/rotation/index.html과 같은 코드예요. 파일 이름이 _로 시작하면 Vercel이 따로 주소를 만들지 않아요)
// 나만의 회전체 만들기 — 도형 검사·비교 (화면과 서버(api/_rotlib.js)가 같은 코드를 써요)
// 도형 = 격자점 [r, z] 들을 차례로 이은 닫힌 다각형 (r ≥ 0: 회전축에서 떨어진 거리, z: 축 방향). 속은 채우지 않은 선으로 된 도형으로 봐요.
const ROT_GRID = { R: 5, Z: 8 };          // r는 0~5, z는 0~8 (정수 격자점)
const ROT_MIN_V = 3, ROT_MAX_V = 14;

const _cr = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const _sg = v => (v > 0) - (v < 0);
const _onSeg = (a, b, c) => Math.min(a[0], b[0]) <= c[0] && c[0] <= Math.max(a[0], b[0]) && Math.min(a[1], b[1]) <= c[1] && c[1] <= Math.max(a[1], b[1]);
// 두 선분 ab, cd가 한 점이라도 만나는가 (끝점이 닿는 경우 포함)
function rotSegTouch(a, b, c, d) {
  const d1 = _sg(_cr(a, b, c)), d2 = _sg(_cr(a, b, d)), d3 = _sg(_cr(c, d, a)), d4 = _sg(_cr(c, d, b));
  if (d1 !== d2 && d3 !== d4) return true;
  if (d1 === 0 && _onSeg(a, b, c)) return true;
  if (d2 === 0 && _onSeg(a, b, d)) return true;
  if (d3 === 0 && _onSeg(c, d, a)) return true;
  if (d4 === 0 && _onSeg(c, d, b)) return true;
  return false;
}
const _eq = (p, q) => p[0] === q[0] && p[1] === q[1];

// 선이 서로 겹치거나 꼬이지 않는지 본다. closed가 false이면 지금까지 이은 선(열린 경로)만 본다.
// 돌려주는 값: '' (괜찮음) 또는 'dup'(같은 점 두 번) | 'cross'(선이 만남·겹침)
function rotPathProblem(pts, closed) {
  const n = pts.length;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (_eq(pts[i], pts[j])) return 'dup';
  const m = closed ? n : n - 1;           // 변의 수
  const E = i => [pts[i], pts[(i + 1) % n]];
  for (let i = 0; i < m; i++) {
    for (let j = i + 1; j < m; j++) {
      const adj = j === i + 1 || (closed && i === 0 && j === m - 1);
      const [a, b] = E(i), [c, d] = E(j);
      if (adj) {
        // 이웃한 두 변은 한 끝점에서만 만나야 해요 (같은 직선 위에서 되돌아가면 겹쳐요)
        const s = (j === i + 1) ? b : a;            // 공통 끝점
        const o1 = _eq(s, b) ? a : b, o2 = _eq(s, c) ? d : c;
        if (_cr(s, o1, o2) === 0) {
          const dot = (o1[0] - s[0]) * (o2[0] - s[0]) + (o1[1] - s[1]) * (o2[1] - s[1]);
          if (dot > 0) return 'cross';
        }
      } else if (rotSegTouch(a, b, c, d)) return 'cross';
    }
  }
  return '';
}
function rotArea2(pts) { let s = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; s += p[0] * q[1] - q[0] * p[1]; } return s; }

// 올릴 수 있는 도형인지 검사 → '' 또는 오류 이름
function rotCheck(pts) {
  if (!Array.isArray(pts) || pts.length < ROT_MIN_V || pts.length > ROT_MAX_V) return 'count';
  for (const p of pts) {
    if (!Array.isArray(p) || p.length !== 2 || !Number.isInteger(p[0]) || !Number.isInteger(p[1])) return 'point';
    if (p[0] < 0 || p[0] > ROT_GRID.R || p[1] < 0 || p[1] > ROT_GRID.Z) return 'range';
  }
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) if (_eq(pts[i], pts[j])) return 'dup';
  if (pts.every(p => _cr(pts[0], pts[1], p) === 0)) return 'flat';   // 모든 점이 한 직선 위
  const pr = rotPathProblem(pts, true); if (pr) return pr;
  if (rotArea2(pts) === 0) return 'flat';
  return '';
}

// 회전시켜 같은 입체가 되는 도형인지 비교하기 위한 '단위 선분 집합'
//   · 회전축 위의 변은 면이 되지 않으니 빼고, 변을 격자 한 칸 단위로 쪼개서 이어 붙은 변도 같게 봐요
//   · 입체는 위아래로 옮겨도 모양이 같으니 가장 낮은 점의 높이를 0으로 맞춰요
function rotSteps(pts) {
  const zmin = Math.min.apply(null, pts.map(p => p[1])), set = new Set(), n = pts.length;
  const gcd = (a, b) => b ? gcd(b, a % b) : a;
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    if (p[0] === 0 && q[0] === 0) continue;
    const dr = q[0] - p[0], dz = q[1] - p[1], g = gcd(Math.abs(dr), Math.abs(dz)), sr = dr / g, sz = dz / g;
    for (let k = 0; k < g; k++) {
      const a = [p[0] + k * sr, p[1] - zmin + k * sz], b = [a[0] + sr, a[1] + sz];
      const A = a[0] + ',' + a[1], B = b[0] + ',' + b[1];
      set.add(A < B ? A + '|' + B : B + '|' + A);
    }
  }
  return set;
}
// 같은 크기·같은 모양인가 (위아래로 옮긴 것은 같게 봐요)
function rotSameSize(a, b) {
  const x = rotSteps(a), y = rotSteps(b);
  if (x.size !== y.size) return false;
  for (const k of x) if (!y.has(k)) return false;
  return true;
}

// ── 크기는 달라도 모양이 같은지 ──
// 회전체만 보고는 실제 길이를 알 수 없으니, 가로·세로 길이의 비가 같아서 닮은 도형(회전축 기준 같은 비율로 키우거나 줄인 것)이면 같은 입체로 봐요.
// 회전축 위의 변을 빼고 변을 선분으로 모은 뒤, 가장 먼 거리를 같게 맞춰 비교해요 (정수 계산이라 오차가 없어요).
function rotSegs(pts) {
  const segs = [], n = pts.length;
  for (let i = 0; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; if (!(p[0] === 0 && q[0] === 0)) segs.push([p[0], p[1], q[0], q[1]]); }
  let zmin = Infinity, rmax = 0;
  segs.forEach(g => { zmin = Math.min(zmin, g[1], g[3]); rmax = Math.max(rmax, g[0], g[2]); });
  return { segs: segs.map(g => [g[0], g[1] - zmin, g[2], g[3] - zmin]), rmax };
}
function rotCanon(segs, k) { // 좌표를 k배 하고, 한 직선 위에서 이어지거나 겹친 선분을 하나로 합쳐 글자로 만들어요
  const gcd = (a, b) => b ? gcd(b, a % b) : a, lines = new Map();
  segs.forEach(g => {
    let dr = (g[2] - g[0]) * k, dz = (g[3] - g[1]) * k; const e = gcd(Math.abs(dr), Math.abs(dz)); dr /= e; dz /= e;
    if (dr < 0 || (dr === 0 && dz < 0)) { dr = -dr; dz = -dz; }
    const c = dz * g[0] * k - dr * g[1] * k, key = dz + ',' + (-dr) + ',' + c;
    const t1 = dr * g[0] * k + dz * g[1] * k, t2 = dr * g[2] * k + dz * g[3] * k;
    if (!lines.has(key)) lines.set(key, []); lines.get(key).push([Math.min(t1, t2), Math.max(t1, t2)]);
  });
  const out = [];
  lines.forEach((iv, key) => {
    iv.sort((p, q) => p[0] - q[0]); const m = [];
    iv.forEach(v => { const l = m[m.length - 1]; if (l && v[0] <= l[1]) l[1] = Math.max(l[1], v[1]); else m.push([v[0], v[1]]); });
    out.push(key + ':' + m.map(v => v[0] + '~' + v[1]).join(';'));
  });
  return out.sort().join('|');
}
function rotSame(a, b) {
  const A = rotSegs(a), B = rotSegs(b);
  if (!(A.rmax > 0) || !(B.rmax > 0)) return false;
  return rotCanon(A.segs, B.rmax) === rotCanon(B.segs, A.rmax);
}
if (typeof module !== 'undefined') module.exports = { ROT_GRID, ROT_MIN_V, ROT_MAX_V, rotPathProblem, rotCheck, rotSame, rotSameSize, rotSteps, rotSegTouch };
