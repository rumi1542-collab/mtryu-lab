// 의견함 API: 학생·선생님이 의견·오류를 남기고, 읽는 건 관리자(나)만 해요.
//   POST   /api/feedback  {kind:'bug'|'idea', text, nick, school}   누구나 보낼 수 있어요 (읽는 길은 없어요)
//   GET    /api/feedback                                          관리자 전용 — 최근순 목록 (헤더 x-admin-key)
//   DELETE /api/feedback?id=...                                   관리자 전용 — 한 건 지우기
// 저장: 'fb:list' 목록(최근 500건까지). 실명·학번은 받지 않고, 별명·학교 이름·보낸 시각만 남겨요.
const { configured, redis, send, isAdmin, ipOf, rateLimit } = require('./_lib');
const KEY = 'fb:list', MAX = 500, KINDS = ['bug', 'idea'];
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f<>]/g, '').trim().slice(0, n);

module.exports = async function handler(req, res) {
  if (!['GET', 'POST', 'DELETE'].includes(req.method)) { res.setHeader('Allow', 'GET, POST, DELETE'); return send(res, 405, { error: 'method-not-allowed' }); }
  if (!configured()) return send(res, 503, { error: 'storage-not-configured' });
  try {
    if (req.method === 'POST') {
      let b = req.body; if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = null; } }
      if (!b || !KINDS.includes(b.kind)) return send(res, 400, { error: 'bad-request' });
      const text = clean(b.text, 500);
      if (text.length < 2) return send(res, 400, { error: 'too-short' });
      if (!(await rateLimit(req, 'fb', 8, 3600))) return send(res, 429, { error: 'too-many' });   // 학교는 같은 IP가 많아서 1시간에 8번까지
      const item = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), kind: b.kind, text, nick: clean(b.nick, 8), school: clean(b.school, 20), ts: Date.now() };
      await redis(['LPUSH', KEY, JSON.stringify(item)]);
      await redis(['LTRIM', KEY, 0, MAX - 1]);
      return send(res, 200, { ok: true });
    }
    // 여기부터는 관리자만 (암호를 계속 틀리면 잠깐 막아요)
    if (!process.env.RD_ADMIN_KEY) return send(res, 503, { error: 'admin-not-configured' });
    const tried = Number(await redis(['GET', 'rl:admfail:' + ipOf(req)])) || 0;
    if (tried >= 20) return send(res, 429, { error: 'too-many' });
    if (!isAdmin(req)) { await rateLimit(req, 'admfail', 20, 600); return send(res, 401, { error: 'unauthorized' }); }
    if (req.method === 'GET') {
      const raw = await redis(['LRANGE', KEY, 0, MAX - 1]);
      const items = (raw || []).map(r => { try { return JSON.parse(r); } catch (e) { return null; } }).filter(Boolean);
      return send(res, 200, { items });
    }
    const id = String((req.query || {}).id || '');
    if (!/^[a-z0-9]{4,24}$/.test(id)) return send(res, 400, { error: 'bad-request' });
    const raw = await redis(['LRANGE', KEY, 0, MAX - 1]);
    const hit = (raw || []).find(r => { try { return JSON.parse(r).id === id; } catch (e) { return false; } });
    if (hit) await redis(['LREM', KEY, 1, hit]);
    return send(res, 200, { ok: true, removed: hit ? 1 : 0 });
  } catch (e) {
    return send(res, 500, { error: 'server-error' });
  }
};
