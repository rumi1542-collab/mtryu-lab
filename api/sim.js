// 확률 실험 시뮬레이터 API (Vercel 서버리스 함수)
// 강 건너기·동전 실험실과 같은 Upstash Redis, 같은 학년도·학교 목록(api/config.js)을 써요. 새로 넣을 환경 변수는 없어요.
//
// 학생이 만든 실험(도구 이름·경우·확률)을 학교에 올리면, 같은 학교의 다른 학생이 "결과만 보고" 각 경우의 가능성이 동등한지 판단해요.
// 그래서 **확률은 서버에만 두고 밖으로 내보내지 않아요.** 던지기도 서버가 대신 해 줘요. (개발자 도구로 정답을 볼 수 없게)
//
// 모든 요청은 POST + JSON 이에요. 본문의 act 값으로 구분해요. (uid는 기기별 익명 번호예요)
//   {act:'publish', year, school, uid, nick, tool, cases:[…], w:[…]}  실험 올리기 → { id }
//   {act:'list',    year, school, uid}                                 우리 학교 실험 목록 → { items }
//   {act:'get',     id, uid}                                           실험 하나 → { item }
//   {act:'roll',    id, n}                                            n번 던지기 → { r: '0132…' }  (경우 번호를 한 글자씩)
//   {act:'rollk',   id, n, k, pick}                                    n번씩 k회, 경우 pick의 도수 k개 → { c:[…] }
//   {act:'vote',    id, uid, choice:'e'|'n'}                           판정하기 (e=동등하다, n=동등하지 않다) → { tally, my }
//   {act:'remove',  id, uid}                                           내가 올린 실험 지우기 (관리자는 헤더 x-admin-key 로 누구 것이든)
//
// item = { id, tool, cases, nick, ts, voters, mine, my, tally? }
//   my: 내가 고른 판정(없으면 null)   tally: {e, n} 은 내가 올린 실험이거나 내가 판정한 뒤에만 보내요

const crypto = require('crypto');
const { configured, redis, redisMulti, send, getConfig, isAdmin, rateLimit } = require('./_lib');
const { badName } = require('./_names');
const L = require('./_simlib');

const KEEP = 100;               // 학교·학년도마다 최대 100개 (넘으면 오래된 것부터 지워요)
const LIST_MAX = 50;            // 목록에 보여 주는 최근 실험 수
const OWN_MAX = 10;             // 한 사람(기기)이 올려 둘 수 있는 실험 수
const TTL = 400 * 86400;        // 약 13개월 뒤 저절로 지워져요

const kE = id => 'sm:e:' + id;          // 실험 본문(JSON)
const kV = id => 'sm:v:' + id;          // 판정 집계(해시 e, n)
const kU = id => 'sm:vu:' + id;         // 누가 판정했는지(해시 uid → e|n) — 한 사람이 한 번만
const kIdx = (y, s) => 'sm:idx:' + Number(y) + ':' + s;   // 학교·학년도별 실험 번호(시간순)
const kOwn = uid => 'sm:own:' + uid;    // 내가 올린 실험 번호

const okId = id => typeof id === 'string' && /^[a-f0-9]{10}$/.test(id);
const okUid = u => typeof u === 'string' && /^[a-f0-9]{32}$/.test(u);

async function validYearSchool(year, school) {
  const y = Number(year);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) return false;
  if (typeof school !== 'string' || school.length < 1 || school.length > 30) return false;
  const c = await getConfig();
  return c.years.includes(y) && c.schools.includes(school);
}

function parse(raw) { try { return raw ? JSON.parse(raw) : null; } catch (e) { return null; } }
const num = v => Number(v) || 0;

// 밖으로 내보낼 모양 (확률 p·정답 eq·올린 사람의 uid는 절대 넣지 않아요)
function toItem(e, cnt, my, uid) {
  const mine = !!(uid && e.uid === uid);
  const item = { id: e.id, tool: e.tool, cases: e.cases, nick: e.nick, ts: e.ts, voters: cnt.e + cnt.n, mine, my: my === 'e' || my === 'n' ? my : null };
  if (mine || item.my) item.tally = { e: cnt.e, n: cnt.n };
  return item;
}

async function loadItems(ids, uid) {
  if (!ids.length) return [];
  const cmds = [['MGET'].concat(ids.map(kE))];
  ids.forEach(id => { cmds.push(['HMGET', kV(id), 'e', 'n']); cmds.push(uid ? ['HGET', kU(id), uid] : ['ECHO', '']); });
  const r = await redisMulti(cmds);
  const out = [];
  ids.forEach((id, i) => {
    const e = parse(r[0][i]);
    if (!e) return;
    const v = r[1 + i * 2] || [];
    const my = r[2 + i * 2];
    out.push(toItem(e, { e: num(v[0]), n: num(v[1]) }, my, uid));
  });
  return out;
}

async function dropExperiment(e) {
  const cmds = [['DEL', kE(e.id)], ['DEL', kV(e.id)], ['DEL', kU(e.id)], ['ZREM', kIdx(e.year, e.school), e.id]];
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

    // ── 던지기: 서버가 확률대로 던져서 결과만 돌려줘요 ──
    if (act === 'roll' || act === 'rollk') {
      if (!okId(b.id)) return send(res, 400, { error: 'bad-request' });
      // 학교는 같은 IP를 쓰는 경우가 많아서 넉넉하게
      if (!(await rateLimit(req, 'simroll', 600, 60))) return send(res, 429, { error: 'too-many' });
      const e = parse(await redis(['GET', kE(b.id)]));
      if (!e) return send(res, 404, { error: 'not-found' });
      if (act === 'roll') {
        if (!L.isInt(b.n, 1, L.MAX_ROLL)) return send(res, 400, { error: 'bad-count' });
        const idx = L.roll(e.p, b.n);
        let s = '';
        for (let i = 0; i < idx.length; i++) s += String.fromCharCode(48 + idx[i]);
        return send(res, 200, { r: s });
      }
      if (!L.isInt(b.n, 1, L.MAX_REP_N) || !L.isInt(b.k, 1, L.MAX_REP_K) || b.n * b.k > L.MAX_REP_TOTAL || !L.isInt(b.pick, 0, e.cases.length - 1)) {
        return send(res, 400, { error: 'bad-count' });
      }
      return send(res, 200, { c: L.rollRep(e.p, b.n, b.k, b.pick) });
    }

    // ── 올리기 ──
    if (act === 'publish') {
      if (!okUid(b.uid) || !(await validYearSchool(b.year, b.school))) return send(res, 400, { error: 'bad-request' });
      if (!(await rateLimit(req, 'simw', 60, 60))) return send(res, 429, { error: 'too-many' });
      const nick = String(b.nick || '').replace(/[<>\s\u0000-\u001f]/g, '').slice(0, 8);
      if (!nick || badName(nick)) return send(res, 400, { error: 'bad-name' });
      const ex = L.buildExperiment(b, badName);
      if (!ex) return send(res, 400, { error: 'bad-experiment' });
      const own = Number(await redis(['ZCARD', kOwn(uid)])) || 0;
      if (own >= OWN_MAX) return send(res, 400, { error: 'too-many-mine' });
      const id = crypto.randomBytes(5).toString('hex');
      const ts = Date.now();
      const e = { id, year: Number(b.year), school: b.school, tool: ex.tool, cases: ex.cases, p: ex.p, eq: L.isEqual(ex.p), nick, uid, ts };
      const idx = kIdx(b.year, b.school);
      await redisMulti([
        ['SET', kE(id), JSON.stringify(e), 'EX', TTL],
        ['ZADD', idx, ts, id], ['EXPIRE', idx, TTL],
        ['ZADD', kOwn(uid), ts, id], ['EXPIRE', kOwn(uid), TTL]
      ]);
      // 학교당 KEEP개를 넘으면 오래된 것부터 지워요
      const total = Number(await redis(['ZCARD', idx])) || 0;
      if (total > KEEP) {
        const oldIds = await redis(['ZRANGE', idx, 0, total - KEEP - 1]);
        for (const oid of oldIds || []) {
          const oe = parse(await redis(['GET', kE(oid)]));
          if (oe) await dropExperiment(oe); else await redis(['ZREM', idx, oid]);
        }
      }
      return send(res, 200, { id });
    }

    // ── 목록 / 하나 보기 ──
    if (act === 'list') {
      if (!(await validYearSchool(b.year, b.school))) return send(res, 400, { error: 'bad-request' });
      if (!(await rateLimit(req, 'siml', 300, 60))) return send(res, 429, { error: 'too-many' });
      const ids = await redis(['ZREVRANGE', kIdx(b.year, b.school), 0, LIST_MAX - 1]);
      return send(res, 200, { items: await loadItems(ids || [], uid) });
    }
    if (act === 'get') {
      if (!okId(b.id)) return send(res, 400, { error: 'bad-request' });
      if (!(await rateLimit(req, 'siml', 300, 60))) return send(res, 429, { error: 'too-many' });
      const items = await loadItems([b.id], uid);
      if (!items.length) return send(res, 404, { error: 'not-found' });
      return send(res, 200, { item: items[0] });
    }

    // ── 판정하기: 한 사람이 한 번만, 내 실험에는 못 해요 ──
    if (act === 'vote') {
      if (!okId(b.id) || !okUid(b.uid) || (b.choice !== 'e' && b.choice !== 'n')) return send(res, 400, { error: 'bad-request' });
      if (!(await rateLimit(req, 'simw', 60, 60))) return send(res, 429, { error: 'too-many' });
      const e = parse(await redis(['GET', kE(b.id)]));
      if (!e) return send(res, 404, { error: 'not-found' });
      if (e.uid === uid) return send(res, 400, { error: 'own-experiment' });
      const first = Number(await redis(['HSETNX', kU(b.id), uid, b.choice])) === 1;
      if (first) await redisMulti([['HINCRBY', kV(b.id), b.choice, 1], ['EXPIRE', kV(b.id), TTL], ['EXPIRE', kU(b.id), TTL]]);
      const r = await redisMulti([['HMGET', kV(b.id), 'e', 'n'], ['HGET', kU(b.id), uid]]);
      return send(res, 200, { tally: { e: num(r[0][0]), n: num(r[0][1]) }, my: r[1], already: !first });
    }

    // ── 지우기 ──
    if (act === 'remove') {
      if (!okId(b.id)) return send(res, 400, { error: 'bad-request' });
      const e = parse(await redis(['GET', kE(b.id)]));
      if (!e) return send(res, 404, { error: 'not-found' });
      if (!isAdmin(req) && !(uid && e.uid === uid)) return send(res, 401, { error: 'unauthorized' });
      await dropExperiment(e);
      return send(res, 200, { ok: true });
    }

    return send(res, 400, { error: 'bad-act' });
  } catch (e) {
    return send(res, 500, { error: 'server-error' });
  }
};
