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
//   {act:'step',    id, uid, n(1~200), total?, tok?, preview?}                   학생이 던지기 → { r: '0132…', total, tok, toks }  (경우 번호를 한 글자씩. 던진 횟수는 서버가 서명해서 이어 줘요)
//   {act:'vote',    id, uid, choice:'e'|'n', total, tok}                           판정하기 (e=동등하다, n=동등하지 않다) → { tally, my, eq, ok, n }  (정답 eq·맞았는지 ok·던진 횟수 n)
//   {act:'stats',   id, uid}                                           집계(만든 사람·관리자만) → { eq, tally, items:[{ok,n}], legacy }
//   {act:'remove',  id, uid}                                           내가 올린 실험 지우기 (관리자는 헤더 x-admin-key 로 누구 것이든)
//   {act:'feature', id, on:true|false}                                 추천 실험으로 올리기/내리기 (관리자만, 헤더 x-admin-key)
//   {act:'adminedit', id, tool, cases, w, nick?}                       실험 고치기 (관리자만) — 판정 기록은 새 정답으로 다시 채점
//   {act:'resetvotes', id}                                             판단 기록만 지우기 (관리자만)
//   {act:'adminping'}                                                  관리자 암호 확인 (관리자만)
//
// 목록 순서: 추천 실험(최근에 추천한 순) → 판정한 친구가 많은 순 → 최근에 올린 순
//
// item = { id, tool, cases, nick, ts, voters, feat, mine, my, tally? }
//   my: 내가 고른 판정(없으면 null)   tally: {e, n} 은 내가 올린 실험이거나 내가 판정한 뒤에만 보내요

const crypto = require('crypto');
const { configured, redis, redisMulti, send, getConfig, isAdmin, rateLimit, isClass, classOf } = require('./_lib');
const { badName } = require('./_names');
const L = require('./_simlib');

const KEEP = 100;               // 학교·학년도마다 최대 100개 (넘으면 오래된 것부터 지워요)
const LIST_MAX = 50;            // 목록에 보여 주는 최근 실험 수
const STEP_MAX = 200;            // 한 번 요청으로 던지는 최대 횟수 (학생은 횟수를 정하지 못하고 속도만 골라요)
const MAX_LIVE = 20000;         // 한 학생이 한 실험에서 이어서 던질 수 있는 최대 횟수
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

// 판정 기록: { c:'e'|'n', n:던진 횟수, ok:옳은지 } (예전 기록은 'e'/'n' 한 글자)
function parseVote(raw) {
  if (raw === 'e' || raw === 'n') return { c: raw, n: null, ok: null };
  try { const o = JSON.parse(raw); if (o && (o.c === 'e' || o.c === 'n')) return o; } catch (e) {}
  return null;
}
// 던진 횟수 서명 (Redis에 쓰지 않고도 서버가 센 값임을 확인해요). 비밀값은 서버 환경 변수에서 만들어요.
const SECRET = () => 'sim|' + (process.env.RD_ADMIN_KEY || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || 'dev');
const signTok = (id, uid, total) => crypto.createHmac('sha256', SECRET()).update(id + '|' + uid + '|' + total).digest('hex').slice(0, 32);
function okTok(id, uid, total, tok) {
  if (typeof tok !== 'string' || tok.length !== 32) return false;
  const a = Buffer.from(signTok(id, uid, total)), c = Buffer.from(tok);
  return a.length === c.length && crypto.timingSafeEqual(a, c);
}
// 실험 본문은 서버 메모리에 잠깐 두고 써요 (던질 때마다 Redis를 읽지 않게)
const expCache = new Map(), EXP_TTL = 60000;
async function getExp(id) {
  const hit = expCache.get(id), now = Date.now();
  if (hit && hit.t > now) return hit.e;
  const e = parse(await redis(['GET', kE(id)]));
  if (expCache.size > 200) expCache.clear();
  if (e) expCache.set(id, { e, t: now + EXP_TTL }); else expCache.delete(id);
  return e;
}
// 이 서버 인스턴스 안에서만 세는 간단한 호출 제한 (Redis를 쓰지 않아요)
const localHits = new Map();
function rateLocal(req, name, limit, windowSec) {
  const key = name + ':' + String(req.headers['x-forwarded-for'] || '').split(',')[0].trim(), now = Date.now(), h = localHits.get(key);
  if (localHits.size > 2000) localHits.clear();
  if (!h || h.t < now) { localHits.set(key, { t: now + windowSec * 1000, n: 1 }); return true; }
  return ++h.n <= limit;
}
function parse(raw) { try { return raw ? JSON.parse(raw) : null; } catch (e) { return null; } }
const num = v => Number(v) || 0;

// 밖으로 내보낼 모양 (확률 p·정답 eq·올린 사람의 uid는 절대 넣지 않아요)
function toItem(e, cnt, my, uid) {
  const mine = !!(uid && e.uid === uid);
  const v = my ? parseVote(my) : null;
  const c = classOf(e, e.school);   // 만든 친구의 학년·반 (옛 실험은 선운중만 2학년 2반으로 봐요)
  const item = { id: e.id, tool: e.tool, cases: e.cases, nick: e.nick, ts: e.ts, voters: cnt.e + cnt.n, feat: !!e.feat, featTs: e.feat || 0, mine, my: v ? v.c : null };
  if (c) { item.gr = c.gr; item.cl = c.cl; }
  if (v) { item.eq = !!e.eq; item.p = e.p; item.ok = v.ok == null ? (v.c === 'e') === !!e.eq : !!v.ok; item.myN = v.n; }   // 판정한 뒤에만 정답을 알려 줘요
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
  expCache.delete(e.id);
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

    // ── 던지기(학생): 서버가 확률대로 던지고, 던진 횟수는 서명(tok)으로 이어 가요 ──
    //   Redis에 횟수를 쓰지 않아요(요청량 절약). 서버가 {total, tok}을 돌려주면 다음 요청에 그대로 보내고,
    //   판정할 때도 보내요. 서명이 맞지 않으면 인정하지 않아요. 처음 던질 때는 tok 없이 total 0.
    if (act === 'step') {
      if (!okId(b.id) || !okUid(b.uid) || !L.isInt(b.n, 1, STEP_MAX)) return send(res, 400, { error: 'bad-request' });
      const total0 = b.tok ? b.total : 0;
      if (!L.isInt(total0, 0, MAX_LIVE) || (b.tok && !okTok(b.id, b.uid, total0, b.tok))) return send(res, 400, { error: 'bad-token' });
      if (!rateLocal(req, 'step', 1500, 60)) return send(res, 429, { error: 'too-many' });
      const e = await getExp(b.id);
      if (!e) return send(res, 404, { error: 'not-found' });
      // 만든 사람과 관리자는 preview:true 로 미리 던져 볼 수 있어요 (판정은 못 하고 기록도 남지 않아요)
      if (b.preview === true) { if (e.uid !== b.uid && !isAdmin(req)) return send(res, 401, { error: 'unauthorized' }); }
      else if (e.uid === b.uid) return send(res, 400, { error: 'own-experiment' });
      if (total0 + b.n > MAX_LIVE) return send(res, 400, { error: 'limit' });
      const idx = L.roll(e.p, b.n);
      let s = '';
      for (let i = 0; i < idx.length; i++) s += String.fromCharCode(48 + idx[i]);
      const total = total0 + b.n;
      // 던진 하나하나에 서명을 붙여 줘요: 화면이 하나씩 보여 주다가 중간에 멈춰도, 보인 만큼의 서명으로 이어 갈 수 있어요
      const toks = []; for (let i = 1; i <= b.n; i++) toks.push(signTok(b.id, b.uid, total0 + i));
      return send(res, 200, { r: s, total, tok: toks[b.n - 1], toks });
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
      const gr = Number(b.gr), cl = Number(b.cl);   // 학년·반 (번호는 받지 않아요)
      const e = Object.assign({ id, year: Number(b.year), school: b.school, tool: ex.tool, cases: ex.cases, p: ex.p, eq: L.isEqual(ex.p), nick, uid, ts }, isClass(gr, cl) ? { gr, cl } : {});
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
      // 학교·학년도의 실험 전체(최대 KEEP개)를 불러와 추천 → 참여(판정 수) → 최근 순으로 정렬해요
      const ids = await redis(['ZREVRANGE', kIdx(b.year, b.school), 0, KEEP - 1]);
      const items = await loadItems(ids || [], uid);
      items.sort((a, c) => (c.featTs - a.featTs) || (c.voters - a.voters) || (c.ts - a.ts));
      items.forEach(it => { delete it.featTs; });
      return send(res, 200, { items: items.slice(0, LIST_MAX) });
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
      // 던진 횟수는 서버가 서명한 값(tok)으로만 인정해요 (한 번도 안 던졌으면 판정할 수 없어요)
      const had = await redis(['HGET', kU(b.id), uid]);
      let thrown = 0;
      if (!had) {
        if (!L.isInt(b.total, 1, MAX_LIVE) || !okTok(b.id, uid, b.total, b.tok)) return send(res, 400, { error: b.total ? 'bad-token' : 'no-throws' });
        thrown = b.total;
      }
      const rec = JSON.stringify({ c: b.choice, n: thrown, ok: (b.choice === 'e') === !!e.eq });
      const first = Number(await redis(['HSETNX', kU(b.id), uid, rec])) === 1;
      if (first) await redisMulti([['HINCRBY', kV(b.id), b.choice, 1], ['EXPIRE', kV(b.id), TTL], ['EXPIRE', kU(b.id), TTL]]);
      const r = await redisMulti([['HMGET', kV(b.id), 'e', 'n'], ['HGET', kU(b.id), uid]]);
      const v = parseVote(r[1]) || { c: b.choice, n: thrown, ok: false };
      // 판정한 뒤에는 정답(같다/같지 않다)과 맞았는지를 알려 줘요
      return send(res, 200, { tally: { e: num(r[0][0]), n: num(r[0][1]) }, my: v.c, already: !first, eq: !!e.eq, p: e.p, ok: v.ok == null ? (v.c === 'e') === !!e.eq : !!v.ok, n: v.n });
    }

    // ── 집계 보기: 만든 사람과 관리자만 (누가 판정했는지는 알 수 없고, 옳은지·던진 횟수만 내보내요) ──
    if (act === 'stats') {
      if (!okId(b.id)) return send(res, 400, { error: 'bad-request' });
      if (!(await rateLimit(req, 'siml', 300, 60))) return send(res, 429, { error: 'too-many' });
      const e = parse(await redis(['GET', kE(b.id)]));
      if (!e) return send(res, 404, { error: 'not-found' });
      if (!isAdmin(req) && !(uid && e.uid === uid)) return send(res, 401, { error: 'unauthorized' });
      const r = await redisMulti([['HGETALL', kU(b.id)], ['HMGET', kV(b.id), 'e', 'n']]);
      const flat = r[0] || [], items = []; let legacy = 0;
      for (let i = 1; i < flat.length; i += 2) {
        const v = parseVote(flat[i]); if (!v) continue;
        if (v.n == null) { legacy++; continue; }
        items.push({ ok: v.ok == null ? (v.c === 'e') === !!e.eq : !!v.ok, n: Number(v.n) || 0 });
      }
      items.sort((a, c) => a.n - c.n);
      return send(res, 200, { eq: !!e.eq, p: e.p, tally: { e: num(r[1][0]), n: num(r[1][1]) }, items: items.slice(0, 5000), legacy });
    }

    // ── 관리자: 암호 확인 / 추천 실험 ──
    if (act === 'adminping') {
      if (!(await rateLimit(req, 'simadm', 30, 600))) return send(res, 429, { error: 'too-many' });
      return isAdmin(req) ? send(res, 200, { ok: true }) : send(res, 401, { error: 'unauthorized' });
    }
    if (act === 'feature') {
      if (!okId(b.id) || typeof b.on !== 'boolean') return send(res, 400, { error: 'bad-request' });
      if (!(await rateLimit(req, 'simadm', 30, 600))) return send(res, 429, { error: 'too-many' });
      if (!isAdmin(req)) return send(res, 401, { error: 'unauthorized' });
      const e = parse(await redis(['GET', kE(b.id)]));
      if (!e) return send(res, 404, { error: 'not-found' });
      if (b.on) e.feat = Date.now(); else delete e.feat;
      await redis(['SET', kE(b.id), JSON.stringify(e), 'EX', TTL]);
      return send(res, 200, { ok: true, feat: !!e.feat });
    }

    // ── 관리자: 실험 고치기 (도구 이름·경우 이름·확률·만든 친구 별명). 판정한 기록은 새 정답에 맞게 다시 채점해요 ──
    if (act === 'adminedit') {
      if (!okId(b.id)) return send(res, 400, { error: 'bad-request' });
      if (!(await rateLimit(req, 'simadm', 30, 600))) return send(res, 429, { error: 'too-many' });
      if (!isAdmin(req)) return send(res, 401, { error: 'unauthorized' });
      const e = parse(await redis(['GET', kE(b.id)]));
      if (!e) return send(res, 404, { error: 'not-found' });
      const ex = L.buildExperiment(b, badName);
      if (!ex) return send(res, 400, { error: 'bad-experiment' });
      let nick = e.nick;
      if (b.nick != null) {
        nick = String(b.nick).replace(/[<>\s\u0000-\u001f]/g, '').slice(0, 8);
        if (!nick || badName(nick)) return send(res, 400, { error: 'bad-name' });
      }
      const eq = L.isEqual(ex.p), flip = eq !== !!e.eq;
      Object.assign(e, { tool: ex.tool, cases: ex.cases, p: ex.p, eq, nick });
      const cmds = [['SET', kE(b.id), JSON.stringify(e), 'EX', TTL]];
      if (flip) {
        // 정답(같다/같지 않다)이 바뀌었으면 판정한 학생들의 맞음·틀림을 다시 계산해요
        const flat = (await redis(['HGETALL', kU(b.id)])) || [];
        for (let i = 0; i + 1 < flat.length; i += 2) {
          const v = parseVote(flat[i + 1]);
          if (!v || v.n == null) continue;   // 예전 기록(한 글자)은 그대로 둬요
          cmds.push(['HSET', kU(b.id), flat[i], JSON.stringify({ c: v.c, n: v.n, ok: (v.c === 'e') === eq })]);
        }
      }
      await redisMulti(cmds);
      expCache.delete(b.id);
      return send(res, 200, { ok: true, eq, changedAnswer: flip });
    }

    // ── 관리자: 판단 기록만 지우기 (실험은 그대로 두고 모든 판단·집계를 0으로) ──
    if (act === 'resetvotes') {
      if (!okId(b.id)) return send(res, 400, { error: 'bad-request' });
      if (!(await rateLimit(req, 'simadm', 30, 600))) return send(res, 429, { error: 'too-many' });
      if (!isAdmin(req)) return send(res, 401, { error: 'unauthorized' });
      const e = await getExp(b.id);
      if (!e) return send(res, 404, { error: 'not-found' });
      await redisMulti([['DEL', kV(b.id)], ['DEL', kU(b.id)]]);
      return send(res, 200, { ok: true });
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
