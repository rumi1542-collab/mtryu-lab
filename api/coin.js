// 동전 실험실 순위 저장 API (Vercel 서버리스 함수)
// 강 건너기(api/scores.js)와 같은 Upstash Redis, 같은 학년도·학교 목록(api/config.js)을 써요.
// 환경 변수는 강 건너기에서 이미 넣은 것을 그대로 쓰면 돼요. (새로 넣을 것 없어요)
//
// game 값: run(연속 맞추기) · tune10 / tune5 / tune2(상대도수 줄타기, 상대도수 범위 0.5±0.10 / 0.05 / 0.02마다 따로) · spot(동전 조작 탐정) · bet(내기 시뮬레이터)
//
// GET    /api/coin?game=&year=&school=&offset=0&limit=10 → { top, total }     순위표 (쪽 나누기)
// GET    /api/coin?game=&year=&school=&q=이름              → { matches, total }  이름 찾기
// GET    /api/coin?game=run&year=&school=&dist=1           → { counts, total }   맞힌 횟수 분포 (연속 맞추기)
// POST   /api/coin  {game,year,school,id,name,uid?, ...게임별 값} → { rank, total }     기록 저장 (name은 순위에 보이는 별명, uid는 공개하지 않는 익명 번호)
// DELETE /api/coin?game=&year=&school=&id=        (헤더 x-admin-key 필요)   기록 1개 삭제
// DELETE /api/coin?game=&year=&school=&ids=a,b,c  (헤더 x-admin-key 필요)   여러 건 삭제
// DELETE /api/coin?game=&year=&school=&all=1      (헤더 x-admin-key 필요)   순위 전체 삭제
//
// 순위 기준 (작은 점수가 위): run은 맞힌 횟수↑, tune은 예상과 안정된 횟수의 차이↓, spot은 맞힌 개수↑, bet은 맞힌 개수↑ — 같으면 먼저 기록한 사람이 위

const { configured, redis, send, getConfig, isAdmin, rateLimit } = require('./_lib');
const { badName } = require('./_names');
const C = require('./_coinlib');

const GAMES = ['run', 'tune10', 'tune5', 'tune2', 'spot', 'bet'];
const PAGE_DEFAULT = 10;
const PAGE_MAX = 100;
const KEEP = 5000;   // 학교·학년도·게임마다 최대 5000개 (tune은 한 줄이 약 0.4KB예요)

// 저장된 기록(JSON 글자)을 풀어서 돌려줘요. 공개하지 않는 익명 번호(uid)는 빼고 내보내요. (api/scores.js와 같은 방식)
function parseMembers(list) {
  return (list || []).map(m => { try { const o = JSON.parse(m); delete o.uid; return o; } catch (e) { return null; } }).filter(Boolean);
}

async function validYearSchool(year, school) {
  const y = Number(year);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) return false;
  if (typeof school !== 'string' || school.length < 1 || school.length > 30) return false;
  const c = await getConfig();
  return c.years.includes(y) && c.schools.includes(school);
}
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

// 게임별로 값을 검사하고, 서버가 직접 계산한 값(점수 등)을 붙여서 돌려줘요. 못 받는 기록이면 null.
// score: Redis에서 작을수록 위인 숫자 (소수점 아래에서 ts를 빼서, 같은 점수일 때 최근 기록이 위)
function build(game, b, ts) {
  if (game === 'run') {
    const seq = String(b.seq || ''), guess = String(b.guess || '');
    if (!/^[HT]+$/.test(seq) || !/^[HT]+$/.test(guess) || seq.length !== guess.length || seq.length > C.MAXRUN) return null;
    let n = 0; while (n < seq.length && seq[n] === guess[n]) n++;
    // 마지막에 틀려서 끝났거나(길이 = n+1), 끝까지 다 맞혔을 때(n = 최대)만 인정
    const finishedByMiss = n === seq.length - 1;
    const maxed = n === C.MAXRUN && seq.length === C.MAXRUN;
    if (!finishedByMiss && !maxed) return null;
    return { data: { seq, guess, n }, score: -n - ts / 1e13 };
  }
  if (game.startsWith('tune')) {
    const w = Number(game.slice(4)), pred = b.pred, hex = String(b.bits || '');
    if (!isInt(pred, 1, C.FLIPS) || !/^[0-9a-f]{250}$/.test(hex)) return null;
    // 안정된 횟수와 차이는 서버가 던진 결과(bits)에서 직접 계산해요
    const first = C.settleTime(C.hexToBits(hex), w), diff = Math.abs(pred - first);
    return { data: { w, pred, bits: hex, first, diff }, score: diff - ts / 1e13 };
  }
  if (game === 'spot') {   // 시작하기: 끝없이 나오는 문제에서 3번 틀리기 전까지 맞힌 개수
    const correct = b.correct;
    if (!isInt(correct, 0, C.ENDLESS_MAX)) return null;
    return { data: { correct }, score: -correct - ts / 1e13 };
  }
  if (game === 'bet') {    // 시작하기: 푼 문제를 서버가 다시 채점하고, 문제 번호에 맞는 난이도(확률 차이)인지, 목숨 규칙대로 끝났는지 확인해요.
    const rounds = b.rounds;
    if (!Array.isArray(rounds) || rounds.length < C.LIVES || rounds.length > C.ENDLESS_MAX + 2 * C.LIVES + Math.ceil(C.ENDLESS_MAX / C.LEVEL_LEN)) return null;
    let hits = 0, lives = C.LIVES;
    for (let i = 0; i < rounds.length; i++) {
      const x = C.pairRound(rounds[i]); if (!x) return null;
      const band = C.gapBand(C.levelOf(i)); if (x.gap < band[0] - 1e-9 || x.gap >= band[1] + 1e-9) return null;
      if (x.ok) hits++; else lives--;
      if (lives <= 0) { if (i !== rounds.length - 1) return null; break; }
      if ((i + 1) % C.LEVEL_LEN === 0) lives = Math.min(C.LIVES, lives + 1);   // 레벨이 오르면 목숨 하나가 돌아와요
    }
    if (lives > 0) return null;                                              // 아직 끝나지 않은 게임은 올릴 수 없어요
    return { data: { score: hits, hits }, score: -hits - ts / 1e13 };
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (!configured()) return send(res, 503, { error: 'storage-not-configured' });

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
    const g = String((req.method === 'POST' ? (body && body.game) : (req.query && req.query.game)) || '');
    if (!GAMES.includes(g)) return send(res, 400, { error: 'bad-game' });

    if (req.method === 'GET') {
      const { year, school } = req.query;
      if (!(await validYearSchool(year, school))) return send(res, 400, { error: 'bad-request' });
      const key = 'cn:' + g + ':' + Number(year) + ':' + school;
      const total = Number(await redis(['ZCARD', key])) || 0;
      if (req.query.dist === '1') {
        if (g !== 'run') return send(res, 400, { error: 'bad-request' });
        const counts = new Array(C.MAXRUN + 1).fill(0);
        parseMembers(await redis(['ZRANGE', key, 0, -1])).forEach(m => { if (isInt(m.n, 0, C.MAXRUN)) counts[m.n]++; });
        return send(res, 200, { counts, total });
      }
      const q = String(req.query.q || '').trim();
      if (q) {
        if (q.length > 8) return send(res, 400, { error: 'bad-query' });
        const all = parseMembers(await redis(['ZRANGE', key, 0, -1]));
        const matches = [];
        for (let i = 0; i < all.length && matches.length < 50; i++) {
          if (String(all[i].name).includes(q)) matches.push(Object.assign({ rank: i + 1 }, all[i]));
        }
        return send(res, 200, { matches, total });
      }
      const offset = Math.min(Math.max(parseInt(req.query.offset, 10) || 0, 0), KEEP);
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || PAGE_DEFAULT, 1), PAGE_MAX);
      const top = parseMembers(await redis(['ZRANGE', key, offset, offset + limit - 1]));
      return send(res, 200, { top, total, offset });
    }

    if (req.method === 'POST') {
      const b = body;
      if (!b || !(await validYearSchool(b.year, b.school))) return send(res, 400, { error: 'bad-request' });
      // 같은 IP에서 1분에 120번까지 (학교는 같은 IP를 쓰는 경우가 많아서 넉넉하게)
      if (!(await rateLimit(req, 'coin', 120, 60))) return send(res, 429, { error: 'too-many' });
      const name = String(b.name || '').replace(/[<>\s\u0000-\u001f]/g, '').slice(0, 8);
      const id = String(b.id || '');
      if (!name || badName(name)) return send(res, 400, { error: 'bad-name' });
      if (!/^[a-z0-9]{4,16}$/.test(id)) return send(res, 400, { error: 'bad-id' });
      const ts = Date.now();
      const built = build(g, b, ts);
      if (!built) return send(res, 400, { error: 'bad-record' });
      const key = 'cn:' + g + ':' + Number(b.year) + ':' + b.school;
      const uid = /^[a-f0-9]{32}$/.test(String(b.uid || '')) ? String(b.uid) : undefined;   // 기기별 익명 번호 (없어도 돼요, 순위표로는 내보내지 않아요)
      const member = JSON.stringify(Object.assign({ id, name, ts, uid }, built.data));
      await redis(['ZADD', key, built.score, member]);
      const rank0 = await redis(['ZRANK', key, member]);
      await redis(['ZREMRANGEBYRANK', key, KEEP, -1]);
      const total = Number(await redis(['ZCARD', key])) || 0;
      return send(res, 200, { rank: (rank0 == null ? KEEP : rank0) + 1, total });
    }

    if (req.method === 'DELETE') {
      if (!isAdmin(req)) return send(res, 401, { error: 'unauthorized' });
      const { year, school, id } = req.query;
      if (!(await validYearSchool(year, school))) return send(res, 400, { error: 'bad-request' });
      const key = 'cn:' + g + ':' + Number(year) + ':' + school;
      if (req.query.all === '1') {
        const n = Number(await redis(['ZCARD', key])) || 0;
        await redis(['DEL', key]);
        return send(res, 200, { removed: n });
      }
      const idList = String(req.query.ids || '').split(',').map(x => x.trim()).filter(Boolean).slice(0, 100);
      if (idList.length) {
        const want = new Set(idList), all = await redis(['ZRANGE', key, 0, -1]);
        const hit = (all || []).filter(m => { try { return want.has(JSON.parse(m).id); } catch (e) { return false; } });
        if (hit.length) await redis(['ZREM', key].concat(hit));
        return send(res, 200, { removed: hit.length });
      }
      if (!id) return send(res, 400, { error: 'bad-request' });
      const all = await redis(['ZRANGE', key, 0, -1]);
      let removed = 0;
      for (const m of all || []) {
        try { if (JSON.parse(m).id === id) { await redis(['ZREM', key, m]); removed++; } } catch (e) {}
      }
      return send(res, 200, { removed });
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return send(res, 405, { error: 'method-not-allowed' });
  } catch (e) {
    return send(res, 500, { error: 'server-error' });
  }
};
