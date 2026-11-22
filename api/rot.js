// 나만의 회전체 만들기 API (Vercel 서버리스 함수)
// 확률 시뮬레이터(api/sim.js)와 같은 Upstash Redis, 같은 학년도·학교 목록(api/config.js)을 써요. 새로 넣을 환경 변수는 없어요.
//
// 학생이 그린 평면도형(격자점 [r, z] 들)으로 만든 회전체를 학교에 올리면, 같은 학교의 다른 학생이 회전체만 보고 원래 도형을 그려 맞혀 봐요.
// 맞았는지는 서버가 정해요: 두 도형을 회전시켰을 때 같은 입체가 되면 맞은 것이에요 (api/_rotlib.js의 rotSame).
//
// 모든 요청은 POST + JSON 이에요. 본문의 act 값으로 구분해요. (uid는 기기별 익명 번호예요)
//   {act:'publish', year, school, uid, nick, gr, cl, pts:[[r,z],…]}   올리기 → { id }
//   {act:'list',    year, school, uid}                                  우리 학교 목록 → { items }  (최근 순, 60개까지)
//   {act:'get',     id, uid}                                            하나 보기 → { item }
//   {act:'guess',   id, uid, pts}                                       내가 그린 도형으로 도전 → { ok, already }  (ok: 이번 도형이 맞는지, 기록에는 처음 도전만 남아요)
//   {act:'remove',  id, uid}                                            내가 올린 것 지우기 (관리자는 헤더 x-admin-key 로 누구 것이든)
//   {act:'adminping'}                                                   관리자 암호 확인 (헤더 x-admin-key)
//
// item = { id, pts, nick, ts, gr, cl, mine, n, my, okN? }
//   n: 도전한 학생 수   my: 내 도전 결과 { ok } (없으면 null)   okN: 맞힌 학생 수 (올린 사람에게만)
// 원래 도형(pts)은 회전체를 그리는 데 꼭 필요해서 목록에 들어 있어요. 화면은 '도형 확인하기'를 누르기 전까지 보여 주지 않아요.

const crypto = require('crypto');
const { configured, redis, redisMulti, send, getConfig, isAdmin, rateLimit, classOf } = require('./_lib');
const { badName } = require('./_names');
const R = require('./_rotlib');

const LIST_READ = 100;          // 목록을 만들 때 학교·학년도마다 최근 100개까지 읽어요
const LIST_MAX = 60;            // 화면에 보내는 최근 회전체 수
const OWN_MAX = 10;             // 한 사람(기기)이 올려 둘 수 있는 회전체 수
const TTL = 400 * 86400;        // 약 13개월 뒤 저절로 지워져요

const kE = id => 'rt:e:' + id;                 // 회전체 본문(JSON)
const kG = id => 'rt:g:' + id;                 // 도전 기록(해시 uid → '1' 맞힘 | '0' 틀림) — 한 사람이 한 번만 기록
const kIdx = (y, s) => 'rt:idx:' + Number(y) + ':' + s;   // 학교·학년도별 번호(시간순)
const kOwn = uid => 'rt:own:' + uid;           // 내가 올린 번호

const okId = id => typeof id === 'string' && /^[a-f0-9]{10}$/.test(id);
const okUid = u => typeof u === 'string' && /^[a-f0-9]{32}$/.test(u);
const parse = raw => { try { return raw ? JSON.parse(raw) : null; } catch (e) { return null; } };

async function validYearSchool(year, school) {
  const y = Number(year);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) return false;
  if (typeof school !== 'string' || school.length < 1 || school.length > 30) return false;
  const c = await getConfig();
  return c.years.includes(y) && c.schools.includes(school);
}

// 밖으로 내보낼 모양 (올린 사람의 uid는 절대 넣지 않아요)
function toItem(e, hash, uid) {
  const vals = Object.keys(hash).map(k => hash[k]);
  const mine = !!(uid && e.uid === uid);
  const c = classOf(e, e.school);
  const item = { id: e.id, pts: e.pts, nick: e.nick, ts: e.ts, mine, n: vals.length, my: hash[uid] != null ? { ok: hash[uid] === '1' } : null };
  if (c) { item.gr = c.gr; item.cl = c.cl; }
  if (mine) item.okN = vals.filter(v => v === '1').length;
  return item;
}
const toHash = flat => { const h = {}; for (let i = 0; i + 1 < (flat || []).length; i += 2) h[flat[i]] = flat[i + 1]; return h; };

async function loadItems(ids, uid) {
  if (!ids.length) return [];
  const cmds = [['MGET'].concat(ids.map(kE))];
  ids.forEach(id => cmds.push(['HGETALL', kG(id)]));
  const r = await redisMulti(cmds);
  const out = [];
  ids.forEach((id, i) => { const e = parse(r[0][i]); if (e) out.push(toItem(e, toHash(r[1 + i]), uid)); });
  return out;
}

async function dropFigure(e) {
  const cmds = [['DEL', kE(e.id)], ['DEL', kG(e.id)], ['ZREM', kIdx(e.year, e.school), e.id]];
  if (e.uid) cmds.push(['ZREM', kOwn(e.uid), e.id]);
  await redisMulti(cmds);
}

module.exports = async function handler(req, res) {
  if (!configured()) return send(res, 503, { error: 'storage-not-configured' });
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { error: 'method-not-allowed' }); }

  try {
    let b = req.body;
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = null; } }
    if (!b || typeof b !== 'object') return send(res, 400, { error: 'bad-request' });
    const act = String(b.act || '');
    const uid = okUid(b.uid) ? b.uid : '';

    // ── 올리기 ──
    if (act === 'publish') {
      if (!okUid(b.uid) || !(await validYearSchool(b.year, b.school))) return send(res, 400, { error: 'bad-request' });
      if (!(await rateLimit(req, 'rotw', 60, 60))) return send(res, 429, { error: 'too-many' });
      const nick = String(b.nick || '').replace(/[<>\s\u0000-\u001f]/g, '').slice(0, 8);
      if (!nick || badName(nick)) return send(res, 400, { error: 'bad-name' });
      if (R.rotCheck(b.pts)) return send(res, 400, { error: 'bad-figure' });
      const own = Number(await redis(['ZCARD', kOwn(uid)])) || 0;
      if (own >= OWN_MAX) return send(res, 400, { error: 'too-many-mine' });
      const id = crypto.randomBytes(5).toString('hex'), ts = Date.now();
      const gr = Number(b.gr), cl = Number(b.cl);   // 학년·반 (번호는 받지 않아요)
      const pts = b.pts.map(p => [p[0], p[1]]);
      const e = Object.assign({ id, year: Number(b.year), school: b.school, pts, nick, uid, ts }, (Number.isInteger(gr) && gr >= 0 && gr <= 6 && Number.isInteger(cl) && cl >= 0 && cl <= 30) ? { gr, cl } : {});
      const idx = kIdx(b.year, b.school);
      await redisMulti([
        ['SET', kE(id), JSON.stringify(e), 'EX', TTL],
        ['ZADD', idx, ts, id], ['EXPIRE', idx, TTL],
        ['ZADD', kOwn(uid), ts, id], ['EXPIRE', kOwn(uid), TTL]
      ]);
      return send(res, 200, { id });
    }

    // ── 목록 / 하나 보기 ──
    if (act === 'list') {
      if (!(await validYearSchool(b.year, b.school))) return send(res, 400, { error: 'bad-request' });
      if (!(await rateLimit(req, 'rotl', 300, 60))) return send(res, 429, { error: 'too-many' });
      const ids = await redis(['ZREVRANGE', kIdx(b.year, b.school), 0, LIST_READ - 1]);
      const items = await loadItems(ids || [], uid);
      items.sort((a, c) => c.ts - a.ts);
      return send(res, 200, { items: items.slice(0, LIST_MAX) });
    }
    if (act === 'get') {
      if (!okId(b.id)) return send(res, 400, { error: 'bad-request' });
      if (!(await rateLimit(req, 'rotl', 300, 60))) return send(res, 429, { error: 'too-many' });
      const items = await loadItems([b.id], uid);
      if (!items.length) return send(res, 404, { error: 'not-found' });
      return send(res, 200, { item: items[0] });
    }

    // ── 도전하기: 내가 그린 도형이 같은 입체가 되는지 서버가 비교해요. 기록에는 처음 도전한 결과만 남아요 ──
    if (act === 'guess') {
      if (!okId(b.id) || !okUid(b.uid)) return send(res, 400, { error: 'bad-request' });
      if (!(await rateLimit(req, 'rotw', 60, 60))) return send(res, 429, { error: 'too-many' });
      if (R.rotCheck(b.pts)) return send(res, 400, { error: 'bad-figure' });
      const e = parse(await redis(['GET', kE(b.id)]));
      if (!e) return send(res, 404, { error: 'not-found' });
      if (e.uid === uid) return send(res, 400, { error: 'own-figure' });
      const ok = R.rotSame(b.pts, e.pts);
      const first = Number(await redis(['HSETNX', kG(b.id), uid, ok ? '1' : '0'])) === 1;
      if (first) await redis(['EXPIRE', kG(b.id), TTL]);
      return send(res, 200, { ok, already: !first });
    }

    // ── 관리자: 암호 확인 ──
    if (act === 'adminping') {
      if (!(await rateLimit(req, 'rotadm', 30, 600))) return send(res, 429, { error: 'too-many' });
      return isAdmin(req) ? send(res, 200, { ok: true }) : send(res, 401, { error: 'unauthorized' });
    }

    // ── 지우기: 내가 올린 것은 내가, 그 밖에는 관리자만 ──
    if (act === 'remove') {
      if (!okId(b.id)) return send(res, 400, { error: 'bad-request' });
      if (!(await rateLimit(req, 'rotadm', 60, 600))) return send(res, 429, { error: 'too-many' });
      const e = parse(await redis(['GET', kE(b.id)]));
      if (!e) return send(res, 404, { error: 'not-found' });
      if (!isAdmin(req) && !(uid && e.uid === uid)) return send(res, 401, { error: 'unauthorized' });
      await dropFigure(e);
      return send(res, 200, { ok: true });
    }

    return send(res, 400, { error: 'bad-act' });
  } catch (e) {
    return send(res, 500, { error: 'server-error' });
  }
};
