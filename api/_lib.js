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

function send(res, code, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(code).json(body);
}

function okConfig(c) {
  return !!c && Array.isArray(c.years) && Array.isArray(c.schools)
    && c.years.length >= 1 && c.years.length <= 12
    && c.years.every(y => Number.isInteger(y) && y >= 2000 && y <= 2100)
    && c.schools.length >= 1 && c.schools.length <= 30
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

module.exports = { configured: () => !!(URL_ && TOKEN), redis, send, okConfig, getConfig, isAdmin, CONFIG_KEY };
