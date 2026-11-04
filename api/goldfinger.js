// 골드핑거 순위 도전 API (Vercel 서버리스 함수)
// 순위에 올라가는 시험은 서버가 직접 만들고 채점해요. (정답 배치를 서버가 정하고, 아는 문제는 서버가 정답으로 채워서, 화면에서 점수를 꾸밀 수 없어요)
// 학생이 정하는 건 '아는 문제 수'와 '찍은 답(마킹)'뿐이에요. 아는 문제는 앞 번호부터 k개(5문제면 1~5번)이고, 정답은 학생이 볼 수 없어요.
// 기록은 동전 실험실과 같은 Upstash Redis에 같은 형식('cn:gf<아는 문제 수>:<학년도>:<학교>')으로 저장돼요.
// 그래서 순위표 읽기·이름 찾기·반별 보기는 /api/coin 을, 기록 삭제·관리자 화면은 /api/coin · /api/admin 을 그대로 써요.
// 환경 변수는 강 건너기에서 이미 넣은 것을 그대로 쓰면 돼요. (새로 넣을 것 없어요)
//
// POST /api/goldfinger {year,school,id,name,uid,gr?,cl?,k,marks:[20]}
//        → { score, key:[20], mine:[20], known:[20 true/false], strat, one, rank, total }
//        k: 아는 문제 수(0·5·10·15) · marks: 학생이 OMR에 마킹한 답 20개(1~5). 아는 문제(앞 k개)는 서버가 정답으로 바꿔요
//        strat(찍는 방법)은 서버가 마킹을 보고 정해요: 찍은 문제가 모두 같은 번호면 one(한 번호), 아니면 free(내맘대로)
//        시험은 여러 번 볼 수 있고, 학교·학년도·아는 문제 수마다 한 사람(uid)의 가장 높은 점수 하나만 순위에 올라가요 (best·improved·tries 로 알려 줘요)
// GET  /api/goldfinger?year=&school=&uid=   → { mine: { "0": rec|null, "5": rec|null, "10": rec|null, "15": rec|null } }   내 기록(순위 포함)
//
// 순위 기준: 점수가 높을수록 위 (같으면 같은 순위, 점수 소수점 아래에서 ts를 빼서 같은 점수는 최근 기록이 위)

const crypto = require('crypto');
const { configured, redis, send, getConfig, rateLimit, isClass, tieRank, rankValue } = require('./_lib');
const { badName } = require('./_names');

const N = 20, PTS = 5, KS = [0, 5, 10, 15], KEEP = 5000;
const keyOf = (k, y, s) => 'cn:gf' + k + ':' + Number(y) + ':' + s;

const rnd = n => crypto.randomInt(n);
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

async function validYearSchool(year, school) {
  const y = Number(year);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) return false;
  if (typeof school !== 'string' || school.length < 1 || school.length > 30) return false;
  const c = await getConfig();
  return c.years.includes(y) && c.schools.includes(school);
}

// 서버가 시험을 만들고 채점해요: 정답은 각 번호 4개씩, 아는 문제는 k개, 나머지는 고른 방법으로 찍어요
function makeExam(k, marks) {
  const key = [];
  for (let v = 1; v <= 5; v++) for (let c = 0; c < N / 5; c++) key.push(v);
  shuffle(key);
  const known = Array.from({ length: N }, (_, i) => i < k);   // 아는 문제는 앞 번호부터
  const mine = key.map((ans, i) => known[i] ? ans : marks[i]);
  let hits = 0; mine.forEach((v, i) => { if (v === key[i]) hits++; });
  const guessed = mine.filter((v, i) => !known[i]);
  const one = guessed.length && guessed.every(v => v === guessed[0]) ? guessed[0] : 0;
  return { key, mine, known, score: hits * PTS, strat: one ? 'one' : 'free', one };
}

// 저장된 기록을 화면에 줄 모양으로 바꿔요 (익명 번호는 빼요)
function view(o) {
  const digits = s => Array.from(String(s || '')).map(Number);
  return { id: o.id, name: o.name, ts: o.ts, k: o.k, strat: o.strat, one: o.one, score: o.score,
    key: digits(o.key), mine: digits(o.mine), known: Array.from(String(o.kn || '')).map(c => c === '1') };
}
async function withRank(k, year, school, o) {
  const rank = await tieRank(redis, keyOf(k, year, school), rankValue('gf' + k, o));
  return Object.assign(view(o), { rank });
}
async function findMine(k, year, school, uid) {
  const raw = await redis(['ZRANGE', keyOf(k, year, school), 0, -1]);
  for (const m of raw || []) { try { const o = JSON.parse(m); if (o.uid === uid) return { o, raw: m }; } catch (e) {} }
  return null;
}

module.exports = async function handler(req, res) {
  if (!configured()) return send(res, 503, { error: 'storage-not-configured' });
  try {
    if (req.method === 'GET') {
      const { year, school, uid } = req.query || {};
      if (!(await validYearSchool(year, school)) || !/^[a-f0-9]{32}$/.test(String(uid || ''))) return send(res, 400, { error: 'bad-request' });
      if (!(await rateLimit(req, 'gfget', 120, 60))) return send(res, 429, { error: 'too-many' });
      const mine = {};
      for (const k of KS) { const f = await findMine(k, year, school, uid); mine[k] = f ? await withRank(k, year, school, f.o) : null; }
      return send(res, 200, { mine });
    }

    if (req.method === 'POST') {
      let b = req.body;
      if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = null; } }
      if (!b || !(await validYearSchool(b.year, b.school))) return send(res, 400, { error: 'bad-request' });
      if (!(await rateLimit(req, 'gf', 120, 60))) return send(res, 429, { error: 'too-many' });
      const name = String(b.name || '').replace(/[<>\s\u0000-\u001f]/g, '').slice(0, 8);
      const id = String(b.id || ''), uid = String(b.uid || '');
      const k = Number(b.k), marks = Array.isArray(b.marks) ? b.marks.map(Number) : [];
      if (!name || badName(name)) return send(res, 400, { error: 'bad-name' });
      if (!/^[a-z0-9]{4,16}$/.test(id)) return send(res, 400, { error: 'bad-id' });
      if (!/^[a-f0-9]{32}$/.test(uid)) return send(res, 400, { error: 'bad-uid' });   // 한 사람의 기록을 가려내려면 익명 번호(내 정보)가 꼭 필요해요
      if (!KS.includes(k) || marks.length !== N || !marks.every((v, i) => i < k || (Number.isInteger(v) && v >= 1 && v <= 5))) return send(res, 400, { error: 'bad-record' });   // 아는 문제 칸은 비어 있어도 돼요
      const year = Number(b.year), school = b.school, key = keyOf(k, year, school);

      // 같은 사람이 동시에 두 번 보내도 한 번만 받아요 (몇 초만 막아요)
      const lock = await redis(['SET', 'gf:lock:' + uid + ':' + k + ':' + year + ':' + school, '1', 'NX', 'EX', 3]);
      if (!lock) return send(res, 429, { error: 'busy' });

      // 시험은 여러 번 볼 수 있고, 순위표에는 그 사람의 가장 높은 점수 하나만 올라가요
      const had = await findMine(k, year, school, uid);
      const ex = makeExam(k, marks);
      const ts = Date.now();
      const gr = Number(b.gr), cl = Number(b.cl), cls = isClass(gr, cl) ? { gr, cl } : {};   // 학년·반 (번호는 받지 않아요)
      const rec = Object.assign({ id, name, ts, uid }, cls, {
        k, strat: ex.strat, one: ex.one, score: ex.score,
        key: ex.key.join(''), mine: ex.mine.join(''), kn: ex.known.map(x => x ? '1' : '0').join('')
      });
      const tries = (had && Number(had.o.tries) || (had ? 1 : 0)) + 1;
      const improved = !had || ex.score > had.o.score;
      let best = rec;
      if (improved) {
        rec.tries = tries;
        if (had) await redis(['ZREM', key, had.raw]);
        await redis(['ZADD', key, -ex.score - ts / 1e13, JSON.stringify(rec)]);
      } else {
        best = Object.assign({}, had.o, { tries });   // 점수는 그대로, 도전 횟수만 늘려요
        await redis(['ZREM', key, had.raw]);
        await redis(['ZADD', key, -best.score - best.ts / 1e13, JSON.stringify(best)]);
      }
      const rank = await tieRank(redis, key, -best.score);   // 같은 점수는 공동 순위
      await redis(['ZREMRANGEBYRANK', key, KEEP, -1]);
      const total = Number(await redis(['ZCARD', key])) || 0;
      return send(res, 200, { score: ex.score, key: ex.key, mine: ex.mine, known: ex.known, strat: ex.strat, one: ex.one, best: best.score, improved, tries, rank, total });
    }

    res.setHeader('Allow', 'GET, POST');
    return send(res, 405, { error: 'method-not-allowed' });
  } catch (e) {
    return send(res, 500, { error: 'server-error' });
  }
};
