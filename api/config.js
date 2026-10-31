// 학년도·학교 목록 API
// GET  /api/config                      → { years:[...], schools:[...] }   (누구나)
// GET  /api/config  + 헤더 x-admin-key  → { ..., admin:true }               (관리자 확인)
// PUT  /api/config  + 헤더 x-admin-key  {years, schools} → 목록 저장
const { configured, redis, send, okConfig, getConfig, isAdmin, CONFIG_KEY } = require('./_lib');

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
      if (!isAdmin(req)) return send(res, 401, { error: 'unauthorized' });
      let b = req.body;
      if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = null; } }
      if (!b) return send(res, 400, { error: 'bad-request' });
      const c = { years: b.years, schools: (b.schools || []).map(s => String(s).trim()) };
      if (!okConfig(c)) return send(res, 400, { error: 'bad-config' });
      c.years = Array.from(new Set(c.years)).sort((x, y) => y - x);
      c.schools = Array.from(new Set(c.schools));
      await redis(['SET', CONFIG_KEY, JSON.stringify(c)]);
      return send(res, 200, c);
    }
    res.setHeader('Allow', 'GET, PUT');
    return send(res, 405, { error: 'method-not-allowed' });
  } catch (e) {
    return send(res, 500, { error: 'server-error' });
  }
};
