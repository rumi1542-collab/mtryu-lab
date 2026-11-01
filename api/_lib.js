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

async function getConfig() {
  try {
    const raw = await redis(['GET', CONFIG_KEY]);
    if (raw) { const c = JSON.parse(raw); if (okConfig(c)) return c; }
  } catch (e) {}
  return { years: DEFAULT_CONFIG.years.slice(), schools: DEFAULT_CONFIG.schools.slice() };
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

module.exports = { kstDay, redisMulti, ipOf, rateLimit, neisBudget, neisSearch, configured: () => !!(URL_ && TOKEN), redis, send, okConfig, getConfig, isAdmin, CONFIG_KEY };
