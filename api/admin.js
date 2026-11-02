// 관리자 전용 조회 API (헤더 x-admin-key 에 관리자 암호 RD_ADMIN_KEY 가 맞아야 해요)
//   GET /api/admin?op=ping                                  → { ok:true }  (암호 확인)
//   GET /api/admin?op=stats&days=7&units=prob,river,coin    → 접속 분석 (units를 안 쓰면 전체)
//   GET /api/admin?op=counts&year=2026                      → 학교·게임별 기록 수
//   GET /api/admin?op=records&game=river|run|tune10|tune5|tune2|spot|bet&year=&school=&sort=recent|oldest|rank&offset=0&limit=20&q=별명
//                                                           → 기록 목록 (순위·별명·학년·반·기록·시각·익명 번호 앞 8자리). &cls=2-3 을 붙이면 그 반만
//   POST /api/admin?op=setclass  {game,year,school,ids:[...],gr?,cl}   고른 기록의 반(과 학년)을 바꿔요 (gr를 빼면 학년은 그대로)
// 기록 삭제는 기존 DELETE /api/scores · /api/coin 을 그대로 써요 (같은 관리자 암호).
const { configured, redis, redisMulti, send, getConfig, isAdmin, ipOf, rateLimit, kstDay, classOf, parseCls, isClass, rankValue } = require('./_lib');
const UNITS = ['home', 'math', 'stat', 'prob', 'river', 'coin', 'sim', 'game'];
const COIN_GAMES = ['run', 'tune10', 'tune5', 'tune2', 'spot', 'bet'];
const GAMES = ['river'].concat(COIN_GAMES);
const MAX_RANGE = 90;

const keyOf = (game, year, school) => game === 'river' ? 'rd:' + Number(year) + ':' + school : 'cn:' + game + ':' + Number(year) + ':' + school;
function summary(game, m) {
  if (game === 'river') return m.rolls + '번 굴림';
  if (game === 'run') return m.n + '연속';
  if (game.startsWith('tune')) return '예상과 ' + m.diff + '번 차이';
  if (game === 'spot') return m.correct + '문제 맞힘';
  if (game === 'bet') return (m.hits != null ? m.hits : m.score) + '문제 맞힘';
  return '';
}
function days(n) { const out = []; for (let i = n - 1; i >= 0; i--) out.push(kstDay(Date.now() - i * 86400e3)); return out; }
function pairs(flat) { const o = {}; for (let i = 0; i + 1 < (flat || []).length; i += 2) o[flat[i]] = Number(flat[i + 1]) || 0; return o; }

module.exports = async function handler(req, res) {
  const isRescore = req.method === 'POST' && ['rescore', 'setclass'].includes((req.query || {}).op);
  if (req.method !== 'GET' && !isRescore) { res.setHeader('Allow', 'GET, POST'); return send(res, 405, { error: 'method-not-allowed' }); }
  if (!configured()) return send(res, 503, { error: 'storage-not-configured' });
  if (!process.env.RD_ADMIN_KEY) return send(res, 503, { error: 'admin-not-configured' });
  try {
    // 암호를 계속 틀리면 잠깐 막아요 (10분에 20번)
    const tried = Number(await redis(['GET', 'rl:admfail:' + ipOf(req)])) || 0;
    if (tried >= 20) return send(res, 429, { error: 'too-many' });
    if (!isAdmin(req)) { await rateLimit(req, 'admfail', 20, 600); return send(res, 401, { error: 'unauthorized' }); }

    const q = req.query || {};
    // 예전에 쌓인 기록의 점수 규칙(같은 점수면 먼저 낸 사람이 위)을 새 규칙(최근 기록이 위)으로 한 번 바꿔요. 여러 번 눌러도 안전해요.
    if (q.op === 'rescore') {
      const cfg0 = await getConfig(); let keys = 0, fixed = 0;
      const years = Array.from(new Set(cfg0.years.concat(Array.from({ length: 12 }, (_, i) => 2020 + i))));
      for (const g of GAMES) for (const y of years) for (const s of cfg0.schools) {
        const k = keyOf(g, y, s), flat = await redis(['ZRANGE', k, 0, -1, 'WITHSCORES']);
        if (!flat || !flat.length) continue; keys++;
        const cmds = [];
        for (let i = 0; i + 1 < flat.length; i += 2) {
          let ts; try { ts = JSON.parse(flat[i]).ts; } catch (e) { continue; }
          const sc = Number(flat[i + 1]); if (!Number.isFinite(ts) || !Number.isFinite(sc)) continue;
          const v = Math.round(sc - ts / 1e13);
          if (Math.abs(sc - (v + ts / 1e13)) < 1e-7) cmds.push(['ZADD', k, v - ts / 1e13, flat[i]]);   // 예전 규칙인 기록만 바꿔요
        }
        if (cmds.length) { await redisMulti(cmds); fixed += cmds.length; }
      }
      return send(res, 200, { ok: true, keys, fixed });
    }
    if (q.op === 'ping') return send(res, 200, { ok: true });

    if (q.op === 'stats') {
      const n = Math.min(Math.max(parseInt(q.days, 10) || 7, 1), MAX_RANGE);
      const want = String(q.units || '').split(',').filter(u => UNITS.includes(u));
      const units = want.length ? want : UNITS, all = !want.length;
      const ds = days(n);
      const hashes = await redisMulti(ds.map(d => ['HGETALL', 'hc:' + d]));
      const series = [], totals = {}, schoolVisits = {};
      units.forEach(u => { totals[u] = 0; });
      ds.forEach((d, i) => {
        const h = pairs(hashes[i]), row = { day: d, total: 0, units: {} };
        Object.keys(h).forEach(f => {
          const [u, code] = f.split('|');
          if (!units.includes(u)) return;
          row.total += h[f]; row.units[u] = (row.units[u] || 0) + h[f]; totals[u] += h[f];
          if (code && code !== '-') schoolVisits[code] = (schoolVisits[code] || 0) + h[f];
        });
        series.push(row);
      });
      const codes = Object.keys(schoolVisits).sort((a, b) => schoolVisits[b] - schoolVisits[a]).slice(0, 30);
      const cmds = [];
      // 사용자 수: 기간 안 모든 날의 익명 번호를 합쳐서 세요 (같은 사람은 한 명)
      const uKeys = []; ds.forEach(d => units.forEach(u => uKeys.push('hu:' + d + ':u:' + u)));
      cmds.push(['PFCOUNT'].concat(all ? ds.map(d => 'hu:' + d + ':all') : uKeys));
      units.forEach(u => cmds.push(['PFCOUNT'].concat(ds.map(d => 'hu:' + d + ':u:' + u))));
      if (all) codes.forEach(c => cmds.push(['PFCOUNT'].concat(ds.map(d => 'hu:' + d + ':s:' + c))));
      cmds.push(['HMGET', 'hs'].concat(codes.length ? codes : ['-']));
      const out = await redisMulti(cmds);
      const usersByUnit = {}; units.forEach((u, i) => { usersByUnit[u] = Number(out[1 + i]) || 0; });
      const names = out[out.length - 1] || [];
      const schools = codes.map((c, i) => ({ code: c, name: names[i] || c, visits: schoolVisits[c], users: all ? (Number(out[1 + units.length + i]) || 0) : null }));
      return send(res, 200, { days: ds, series, totals, visits: series.reduce((a, r) => a + r.total, 0), users: Number(out[0]) || 0, usersByUnit, schools });
    }

    const cfg = await getConfig();
    const year = Number(q.year);
    if (q.op === 'counts') {
      const y = cfg.years.includes(year) ? year : cfg.years[0];
      const schools = cfg.schools.slice(0, 60);
      const cmds = []; schools.forEach(s => GAMES.forEach(g => cmds.push(['ZCARD', keyOf(g, y, s)])));
      const out = cmds.length ? await redisMulti(cmds) : [];
      const rows = schools.map((s, i) => { const r = { school: s }; GAMES.forEach((g, j) => { r[g] = Number(out[i * GAMES.length + j]) || 0; }); return r; });
      return send(res, 200, { year: y, rows });
    }

    // 고른 기록의 반(과 학년)을 바꿔요. 순위 점수는 그대로 두고 기록 글자만 새로 써요. (예: 내 테스트 기록을 0반으로)
    if (q.op === 'setclass') {
      let b = req.body; if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = null; } }
      const game = String((b && b.game) || ''), school = String((b && b.school) || ''), y = Number(b && b.year);
      const ids = Array.isArray(b && b.ids) ? b.ids.map(String).filter(Boolean).slice(0, 200) : [];
      const newCl = Number(b && b.cl), newGr = b && b.gr != null && b.gr !== '' ? Number(b.gr) : null;
      if (!GAMES.includes(game) || !cfg.years.includes(y) || !cfg.schools.includes(school) || !ids.length || !isClass(newGr == null ? 0 : newGr, newCl)) return send(res, 400, { error: 'bad-request' });
      const key = keyOf(game, y, school), want = new Set(ids);
      const flat = await redis(['ZRANGE', key, 0, -1, 'WITHSCORES']);
      const cmds = []; let changed = 0, skipped = 0;
      for (let i = 0; i + 1 < (flat || []).length; i += 2) {
        let o; try { o = JSON.parse(flat[i]); } catch (e) { continue; }
        if (!want.has(o.id)) continue;
        const gr = newGr != null ? newGr : (classOf(o, school) || {}).gr;
        if (gr == null) { skipped++; continue; }   // 학년을 모르는 기록은 학년을 함께 적어야 바꿀 수 있어요
        const next = JSON.stringify(Object.assign({}, o, { gr, cl: newCl }));
        if (next === flat[i]) continue;
        cmds.push(['ZADD', key, flat[i + 1], next]); cmds.push(['ZREM', key, flat[i]]); changed++;
      }
      if (cmds.length) await redisMulti(cmds);
      return send(res, 200, { ok: true, changed, skipped });
    }

    if (q.op === 'records') {
      const game = String(q.game || '');
      if (!GAMES.includes(game) || !cfg.years.includes(year) || !cfg.schools.includes(String(q.school || ''))) return send(res, 400, { error: 'bad-request' });
      const sort = ['recent', 'oldest', 'rank'].includes(q.sort) ? q.sort : 'rank';
      const offset = Math.max(parseInt(q.offset, 10) || 0, 0), limit = Math.min(Math.max(parseInt(q.limit, 10) || 20, 1), 100);
      const kw = String(q.q || '').trim().slice(0, 8);
      const raw = await redis(['ZRANGE', keyOf(game, year, q.school), 0, -1]);
      let pv = null, pr = 0;   // 공동 순위: 같은 값이면 같은 순위
      let items = (raw || []).map((m, i) => { try { const o = JSON.parse(m), c = classOf(o, q.school), v = rankValue(game, o), rk = (i > 0 && v === pv) ? pr : i + 1; pv = v; pr = rk; return { rank: rk, id: o.id, name: o.name, gr: c ? c.gr : null, cl: c ? c.cl : null, ts: o.ts, summary: summary(game, o), uid: o.uid ? String(o.uid).slice(0, 8) : '' }; } catch (e) { return null; } }).filter(Boolean);
      const total = items.length;
      const cls = parseCls(q.cls);
      if (cls) items = items.filter(x => x.gr === cls.gr && x.cl === cls.cl);
      if (kw) items = items.filter(x => String(x.name).includes(kw));
      if (sort === 'recent') items.sort((a, b) => b.ts - a.ts);
      else if (sort === 'oldest') items.sort((a, b) => a.ts - b.ts);
      return send(res, 200, { items: items.slice(offset, offset + limit), matched: items.length, total, offset });
    }
    return send(res, 400, { error: 'bad-op' });
  } catch (e) {
    return send(res, 500, { error: 'server-error' });
  }
};
