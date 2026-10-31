// 학교 이름 검색 API (나이스 교육정보 개방포털 '학교기본정보' 사용)
// GET /api/schools?q=선운  → { schools: [{ name, region, kind, addr }] }
// 누구나 쓸 수 있지만, 같은 IP에서 분당 120번, 서버 전체로 하루 5000번까지만 나이스를 호출해요.
// 환경 변수: NEIS_KEY (open.neis.go.kr 에서 발급받은 인증키), RD_ADMIN_KEY
const { configured, send, isAdmin, rateLimit, neisBudget, neisSearch } = require('./_lib');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return send(res, 405, { error: 'method-not-allowed' }); }
  if (!configured()) return send(res, 503, { error: 'storage-not-configured' });
  if (!process.env.NEIS_KEY) return send(res, 503, { error: 'neis-not-configured' });
  const q = String((req.query && req.query.q) || '').trim();
  if (q.length < 2 || q.length > 20 || /[\u0000-\u001f]/.test(q)) return send(res, 400, { error: 'bad-query' });
  try {
    if (!isAdmin(req)) {
      if (!(await rateLimit(req, 'search', 120, 60)) || !(await neisBudget(5000))) return send(res, 429, { error: 'too-many' });
    }
    return send(res, 200, { schools: await neisSearch(q) });
  } catch (e) {
    return send(res, 502, { error: 'neis-failed' });
  }
};
