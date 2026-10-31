// 강 건너기 순위 저장 API (Vercel 서버리스 함수)
// 저장소: Upstash Redis (Vercel Marketplace의 Upstash Redis / 예전 Vercel KV 모두 사용 가능)
//
// 환경 변수
//   KV_REST_API_URL, KV_REST_API_TOKEN            (Vercel KV 방식)
//   또는 UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN  (Upstash 방식)
//   RD_ADMIN_KEY   관리자 암호 (관리자 모드 로그인, 학년도·학교 추가, 기록 삭제에 써요)
//
// GET    /api/scores?year=2026&school=학교     → { top: [...] }          상위 기록
// POST   /api/scores  {year,school,id,name,rolls,setup} → { rank, top }  기록 저장
// DELETE /api/scores?year=&school=&id=        (헤더 x-admin-key 필요)    기록 삭제

const { configured, redis, send, getConfig, isAdmin } = require('./_lib');
const TOP_N = 10;
const KEEP = 200; // 학교·학년도마다 최대 200개 기록만 보관

function parseMembers(list) {
  return (list || []).map(m => { try { return JSON.parse(m); } catch (e) { return null; } }).filter(Boolean);
}

// 관리자 모드에서 등록한 학년도·학교만 받아요
async function validYearSchool(year, school) {
  const y = Number(year);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) return false;
  if (typeof school !== 'string' || school.length < 1 || school.length > 30) return false;
  const c = await getConfig();
  return c.years.includes(y) && c.schools.includes(school);
}

module.exports = async function handler(req, res) {
  if (!configured()) return send(res, 503, { error: 'storage-not-configured' });

  try {
    if (req.method === 'GET') {
      const { year, school } = req.query;
      if (!(await validYearSchool(year, school))) return send(res, 400, { error: 'bad-request' });
      const key = 'rd:' + Number(year) + ':' + school;
      const top = parseMembers(await redis(['ZRANGE', key, 0, TOP_N - 1]));
      return send(res, 200, { top });
    }

    if (req.method === 'POST') {
      let b = req.body;
      if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = null; } }
      if (!b || !(await validYearSchool(b.year, b.school))) return send(res, 400, { error: 'bad-request' });

      const name = String(b.name || '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 8);
      const rolls = Number(b.rolls);
      const id = String(b.id || '');
      const setup = b.setup;
      if (!name) return send(res, 400, { error: 'bad-name' });
      if (!/^[a-z0-9]{4,16}$/.test(id)) return send(res, 400, { error: 'bad-id' });
      // 토큰 12개를 모두 부수려면 최소 12번은 굴려야 해요
      if (!Number.isInteger(rolls) || rolls < 12 || rolls > 2000) return send(res, 400, { error: 'bad-rolls' });
      if (!Array.isArray(setup) || setup.length !== 12 || !setup.every(n => Number.isInteger(n) && n >= 0 && n <= 12)
          || setup.reduce((x, y) => x + y, 0) !== 12) return send(res, 400, { error: 'bad-setup' });
      // 1번 칸은 주사위 합이 될 수 없어서, 거기에 토큰이 있으면 이길 수 없어요
      if (setup[0] !== 0) return send(res, 400, { error: 'bad-setup' });

      const key = 'rd:' + Number(b.year) + ':' + b.school;
      const ts = Date.now();
      const member = JSON.stringify({ id, name, rolls, setup, ts });
      const score = rolls + ts / 1e13; // 굴린 횟수가 같으면 먼저 기록한 사람이 위
      await redis(['ZADD', key, score, member]);
      const rank0 = await redis(['ZRANK', key, member]);
      await redis(['ZREMRANGEBYRANK', key, KEEP, -1]);
      const top = parseMembers(await redis(['ZRANGE', key, 0, TOP_N - 1]));
      return send(res, 200, { rank: (rank0 == null ? KEEP : rank0) + 1, top });
    }

    if (req.method === 'DELETE') {
      if (!isAdmin(req)) return send(res, 401, { error: 'unauthorized' });
      const { year, school, id } = req.query;
      if (!(await validYearSchool(year, school)) || !id) return send(res, 400, { error: 'bad-request' });
      const key = 'rd:' + Number(year) + ':' + school;
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
