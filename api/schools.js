// 학교 이름 검색 API (나이스 교육정보 개방포털 '학교기본정보' 사용)
// GET /api/schools?q=선운   + 헤더 x-admin-key  → { schools: [{ name, region, kind, addr }] }
// 환경 변수: NEIS_KEY (open.neis.go.kr 에서 발급받은 인증키), RD_ADMIN_KEY
// 인증키가 학생 화면에 노출되지 않도록, 서버에서만 나이스를 호출하고 관리자만 쓸 수 있게 했어요.
const { send, isAdmin } = require('./_lib');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return send(res, 405, { error: 'method-not-allowed' }); }
  if (!isAdmin(req)) return send(res, 401, { error: 'unauthorized' });
  const key = process.env.NEIS_KEY;
  if (!key) return send(res, 503, { error: 'neis-not-configured' });
  const q = String((req.query && req.query.q) || '').trim();
  if (q.length < 2 || q.length > 20 || /[\u0000-\u001f]/.test(q)) return send(res, 400, { error: 'bad-query' });
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 6000);
  try {
    const u = 'https://open.neis.go.kr/hub/schoolInfo?Type=json&pIndex=1&pSize=15&KEY=' + encodeURIComponent(key) + '&SCHUL_NM=' + encodeURIComponent(q);
    const r = await fetch(u, { signal: ctl.signal });
    const j = await r.json();
    // 결과가 없으면 { RESULT: { CODE: 'INFO-200' } } 로 와요
    const block = Array.isArray(j.schoolInfo) ? j.schoolInfo.find(x => x && x.row) : null;
    const rows = block ? block.row : [];
    return send(res, 200, { schools: rows.map(x => ({
      name: x.SCHUL_NM, region: String(x.ATPT_OFCDC_SC_NM || '').replace(/교육청$/, ''),
      kind: x.SCHUL_KND_SC_NM || '', addr: x.ORG_RDNMA || ''
    })).filter(x => x.name) });
  } catch (e) {
    return send(res, 502, { error: 'neis-failed' });
  } finally { clearTimeout(t); }
};
