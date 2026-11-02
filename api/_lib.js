// 공통 도구 (파일 이름이 _로 시작하면 Vercel이 따로 주소를 만들지 않아요)
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const DEFAULT_CONFIG = { years: [2026], schools: ['선운중학교'] };
const CONFIG_KEY = 'rd:config';

async function redis(cmd) {
  const r = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd)
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

// 여러 명령을 한 번에 보내요 (Upstash 파이프라인). 결과는 명령 순서대로 돌아오는 값 배열이에요.
async function redisMulti(cmds) {
  const r = await fetch(URL_.replace(/\/$/, '') + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds)
  });
  const j = await r.json();
  if (!Array.isArray(j)) throw new Error('pipeline');
  return j.map(x => { if (x && x.error) throw new Error(x.error); return x ? x.result : null; });
}

// 한국 시간 기준 날짜 'YYYY-MM-DD' (접속 집계를 날짜별로 나눌 때 써요)
function kstDay(ms) { return new Date((ms == null ? Date.now() : ms) + 9 * 3600e3).toISOString().slice(0, 10); }

function send(res, code, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(code).json(body);
}

function okConfig(c) {
  return !!c && Array.isArray(c.years) && Array.isArray(c.schools)
    && c.years.length >= 1 && c.years.length <= 12
    && c.years.every(y => Number.isInteger(y) && y >= 2000 && y <= 2100)
    && c.schools.length >= 1 && c.schools.length <= 200
    && c.schools.every(s => typeof s === 'string' && s.length >= 1 && s.length <= 20 && !/[\u0000-\u001f<>]/.test(s));
}

// 지금 학년도(한국 시간, 3월 1일에 바뀌어요)는 늘 목록에 들어 있어요. 학년도를 따로 추가하지 않아도 새 학년도가 저절로 시작돼요.
function schoolYear(ms) { const d = new Date((ms == null ? Date.now() : ms) + 9 * 3600e3); return d.getUTCMonth() >= 2 ? d.getUTCFullYear() : d.getUTCFullYear() - 1; }
function withCurrentYear(c) {
  const y = schoolYear();
  if (!c.years.includes(y)) c.years = [y].concat(c.years).sort((a, b) => b - a).slice(0, 12);
  return c;
}
async function getConfig() {
  try {
    const raw = await redis(['GET', CONFIG_KEY]);
    if (raw) { const c = JSON.parse(raw); if (okConfig(c)) return withCurrentYear(c); }
  } catch (e) {}
  return withCurrentYear({ years: DEFAULT_CONFIG.years.slice(), schools: DEFAULT_CONFIG.schools.slice() });
}

function isAdmin(req) {
  const k = process.env.RD_ADMIN_KEY;
  return !!k && req.headers['x-admin-key'] === k;
}

// 같은 사람이 너무 자주 호출하지 못하게 막아요 (학교는 같은 IP를 쓰는 경우가 많아서 넉넉하게)
function ipOf(req) { return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'x'; }
async function rateLimit(req, name, limit, windowSec) {
  const ip = ipOf(req);
  const key = 'rl:' + name + ':' + ip;
  const n = Number(await redis(['INCR', key]));
  if (n === 1) await redis(['EXPIRE', key, windowSec]);
  return n <= limit;
}
// 나이스 호출 하루 총량 제한 (인증키 한도를 지키려고)
async function neisBudget(limit) {
  const day = new Date().toISOString().slice(0, 10);
  const key = 'rl:neis:' + day;
  const n = Number(await redis(['INCR', key]));
  if (n === 1) await redis(['EXPIRE', key, 90000]);
  return n <= limit;
}
// ── 학년·반 ──────────────────────────────────────────────────────────────
// 순위 기록에는 학년(gr)·반(cl)이 함께 저장돼요 (번호는 서버로 보내지 않아요).
// 학년·반을 받기 전에 쌓인 기록은 아래 표의 학교만 그 학년·반으로 봐요 (표에 없는 학교의 옛 기록은 '반 없음').
const LEGACY_CLASS = { '선운중학교': { gr: 2, cl: 2 } };
const isClass = (gr, cl) => Number.isInteger(gr) && gr >= 0 && gr <= 6 && Number.isInteger(cl) && cl >= 0 && cl <= 30;
// 기록 하나의 { gr, cl } (모르면 null)
function classOf(m, school) {
  if (m && isClass(m.gr, m.cl)) return { gr: m.gr, cl: m.cl };
  const l = LEGACY_CLASS[school];
  return l ? { gr: l.gr, cl: l.cl } : null;
}
// 조회 주소의 cls=학년-반 (예: 2-3) 읽기. 없거나 모양이 틀리면 null
function parseCls(s) {
  const x = /^(\d{1,2})-(\d{1,2})$/.exec(String(s || '')); if (!x) return null;
  const gr = Number(x[1]), cl = Number(x[2]); return isClass(gr, cl) ? { gr, cl } : null;
}
// 순위표로 내보낼 때: 익명 번호(uid)는 빼고, 학년·반을 채워 줘요 (옛 기록은 위 표대로)
function publicMembers(list, school) {
  return (list || []).map(m => {
    try { const o = JSON.parse(m); delete o.uid; const c = classOf(o, school); if (c) { o.gr = c.gr; o.cl = c.cl; } else { delete o.gr; delete o.cl; } return o; }
    catch (e) { return null; }
  }).filter(Boolean);
}
// 순위(점수 순서) 그대로, 한 반의 기록만. 각 기록의 rank는 '그 반 안에서의' 순위예요.
function onlyClass(items, cls) {
  const out = []; items.forEach(o => { if (o.gr === cls.gr && o.cl === cls.cl) out.push(o); });
  return out;
}
// 학년·반별 기록 수 (옛 기록 포함). 반을 모르는 기록 수는 none
function classCounts(items) {
  const map = {}; let none = 0;
  items.forEach(o => { if (o.gr == null) { none++; return; } const k = o.gr + '-' + o.cl; map[k] = (map[k] || 0) + 1; });
  const classes = Object.keys(map).map(k => { const [gr, cl] = k.split('-').map(Number); return { gr, cl, n: map[k] }; })
    .sort((a, b) => a.gr - b.gr || a.cl - b.cl);
  return { classes, none };
}


// ---- 공동 순위 (300·200·200·100점 → 1위 2위 2위 4위) ----
// Redis 점수는 '값 - ts/1e13' 꼴이라, 값(작을수록 위)이 같으면 같은 순위예요.
function rankValue(game, o) {
  if (game === 'river') return Number(o.rolls);
  if (game === 'run') return -Number(o.n);
  if (String(game).startsWith('tune')) return Number(o.diff);
  if (game === 'spot') return -Number(o.correct);
  return -Number(o.hits != null ? o.hits : o.score);
}
// 순서대로 놓인 기록에 rank를 붙여요. offset = 목록 첫 기록의 전체 순번(0부터), firstRank = 그 기록의 공동 순위
function rankList(items, game, offset, firstRank) {
  let pv = null, pr = 0;
  return items.map((o, i) => {
    const v = rankValue(game, o);
    const r = i === 0 ? firstRank : (v === pv ? pr : (offset || 0) + i + 1);
    pv = v; pr = r; return Object.assign({ rank: r }, o);
  });
}
// 이 값보다 확실히 위인 기록 수 + 1 = 공동 순위 (값이 같은 기록끼리는 점수 소수점만 달라요)
async function tieRank(redis, key, value) {
  const n = Number(await redis(['ZCOUNT', key, '-inf', '(' + (value - 1)])) || 0;
  return n + 1;
}

// 나이스 학교기본정보 검색
async function neisSearch(q) {
  const key = process.env.NEIS_KEY;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 6000);
  try {
    const u = 'https://open.neis.go.kr/hub/schoolInfo?Type=json&pIndex=1&pSize=15&KEY=' + encodeURIComponent(key) + '&SCHUL_NM=' + encodeURIComponent(q);
    const r = await fetch(u, { signal: ctl.signal });
    const j = await r.json();
    const block = Array.isArray(j.schoolInfo) ? j.schoolInfo.find(x => x && x.row) : null;
    return (block ? block.row : []).map(x => ({
      name: x.SCHUL_NM, region: String(x.ATPT_OFCDC_SC_NM || '').replace(/교육청$/, ''),
      kind: x.SCHUL_KND_SC_NM || '', addr: x.ORG_RDNMA || '',
      code: x.SD_SCHUL_CODE || '', edu: x.ATPT_OFCDC_SC_CODE || ''   // 나이스 학교 코드 (기록을 모아 볼 때 동명 학교를 구분해요)
    })).filter(x => x.name);
  } finally { clearTimeout(t); }
}

module.exports = {
  rankValue, rankList, tieRank, LEGACY_CLASS, isClass, classOf, parseCls, publicMembers, onlyClass, classCounts, schoolYear, kstDay, redisMulti, ipOf, rateLimit, neisBudget, neisSearch, configured: () => !!(URL_ && TOKEN), redis, send, okConfig, getConfig, isAdmin, CONFIG_KEY };
