// 학년도·학교 목록 API
// GET  /api/config                      → { years, schools, regions }      (누구나)
// GET  /api/config  + 헤더 x-admin-key  → { ..., admin:true }               (관리자 확인)
// PUT  /api/config  + 헤더 x-admin-key  {years, schools, regions} → 목록 저장 (관리자)
// POST /api/config  {add:{name, region}} → 학교 추가 (누구나, 나이스에 있는 학교만, 횟수 제한)
const { configured, redis, send, okConfig, getConfig, isAdmin, rateLimit, neisBudget, neisSearch, CONFIG_KEY } = require('./_lib');

function cleanRegions(regions, schools) {
  const out = {};
  if (regions && typeof regions === 'object') {
    for (const s of schools) if (typeof regions[s] === 'string' && regions[s].length <= 30) out[s] = regions[s];
  }
  return out;
}
async function saveConfig(c) { await redis(['SET', CONFIG_KEY, JSON.stringify(c)]); }

module.exports = async function handler(req, res) {
  if (!configured()) return send(res, 503, { error: 'storage-not-configured' });
  try {
    if (req.method === 'GET') {
      const c = await getConfig();
      if (req.headers['x-admin-key']) {
        if (!isAdmin(req)) return send(res, 401, { error: 'unauthorized' });
        return send(res, 200, Object.assign({ admin: true }, c));
      }
      return send(res, 200, c);
    }
    if (req.method === 'PUT' || req.method === 'POST') {
      let b = req.body;
      if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = null; } }
      if (!b) return send(res, 400, { error: 'bad-request' });

      // 학생도 쓸 수 있는 학교 추가: 나이스에서 실제로 확인되는 학교만
      if (b.add && !isAdmin(req)) {
        const name = String(b.add.name || '').trim(), region = String(b.add.region || '').trim();
        if (!process.env.NEIS_KEY) return send(res, 503, { error: 'neis-not-configured' });
        if (name.length < 2 || name.length > 20 || !region) return send(res, 400, { error: 'bad-request' });
        if (!(await rateLimit(req, 'add', 10, 600)) || !(await neisBudget(5000))) return send(res, 429, { error: 'too-many' });
        const found = (await neisSearch(name)).some(x => x.name === name && x.region === region);
        if (!found) return send(res, 400, { error: 'not-found' });
        const c = await getConfig();
        c.regions = cleanRegions(c.regions, c.schools);
        let label = name;
        if (c.schools.includes(label) && c.regions[label] && c.regions[label] !== region) {   // 같은 이름의 다른 지역 학교
          label = (name + '(' + region + ')').slice(0, 20);
        }
        if (!c.schools.includes(label)) {
          if (c.schools.length >= 200) return send(res, 400, { error: 'full' });
          c.schools.push(label); c.regions[label] = region;
          await saveConfig(c);
        }
        return send(res, 200, Object.assign({ added: label }, c));
      }

      if (!isAdmin(req)) return send(res, 401, { error: 'unauthorized' });
      const c = { years: b.years, schools: (b.schools || []).map(s => String(s).trim()) };
      if (!okConfig(c)) return send(res, 400, { error: 'bad-config' });
      c.years = Array.from(new Set(c.years)).sort((x, y) => y - x);
      c.schools = Array.from(new Set(c.schools));
      c.regions = cleanRegions(b.regions, c.schools);
      await saveConfig(c);
      return send(res, 200, c);
    }
    res.setHeader('Allow', 'GET, POST, PUT');
    return send(res, 405, { error: 'method-not-allowed' });
  } catch (e) {
    return send(res, 500, { error: 'server-error' });
  }
};
