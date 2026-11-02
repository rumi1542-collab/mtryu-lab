// 강 건너기 순위 저장 API (Vercel 서버리스 함수)
// 저장소: Upstash Redis (Vercel Marketplace의 Upstash Redis / 예전 Vercel KV 모두 사용 가능)
//
// 환경 변수
//   KV_REST_API_URL, KV_REST_API_TOKEN            (Vercel KV 방식)
//   또는 UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN  (Upstash 방식)
//   RD_ADMIN_KEY   관리자 암호 (관리자 모드 로그인, 학년도·학교 추가, 기록 삭제에 써요)
//
// GET    /api/scores?year=&school=&offset=0&limit=10 → { top, total }   순위표 (쪽 나누기)
// GET    /api/scores?...&cls=2-3                       → 같은 형식인데 2학년 3반 기록만 (rank·total도 그 반 안에서)
// GET    /api/scores?year=&school=&classes=1           → { classes:[{gr,cl,n}], none, total } 학년·반별 기록 수
// GET    /api/scores?year=&school=&q=이름              → { matches, total } 이름 찾기 (cls도 같이 쓸 수 있어요)
// POST   /api/scores  {year,school,id,name,rolls,setup,uid?,gr?,cl?} → { rank, top }  기록 저장 (name은 순위에 보이는 별명, gr·cl은 학년·반, uid는 공개하지 않는 익명 번호)
// DELETE /api/scores?year=&school=&id=        (헤더 x-admin-key 필요)    기록 1개 삭제
// DELETE /api/scores?year=&school=&ids=a,b,c  (헤더 x-admin-key 필요)    여러 건 삭제
// DELETE /api/scores?year=&school=&all=1      (헤더 x-admin-key 필요)    순위 전체 삭제

const { configured, redis, send, getConfig, isAdmin, isClass, parseCls, publicMembers, onlyClass, classCounts, rankList, rankValue, tieRank } = require('./_lib');
const { badName } = require('./_names');
const PAGE_DEFAULT = 10;
const PAGE_MAX = 100;
const KEEP = 20000; // 학교·학년도마다 최대 2만 개 기록 (한 줄에 약 150바이트 → 3MB 정도라 부담이 없어요)

// 순위표로 내보낼 때는 익명 번호(uid)를 빼요. uid는 나중에 로그인할 때 '이 기기의 기록 가져오기'에만 쓰려고 저장만 해 둬요. (학년·반을 채우는 일은 _lib.js의 publicMembers)
const parseMembers = publicMembers;

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
      const total = Number(await redis(['ZCARD', key])) || 0;
      // 학년·반별 기록 수 (순위표의 반 고르기 목록)
      if (req.query.classes === '1') {
        const cc = classCounts(parseMembers(await redis(['ZRANGE', key, 0, -1]), school));
        return send(res, 200, { classes: cc.classes, none: cc.none, total });
      }
      const cls = parseCls(req.query.cls);   // 2-3 → 2학년 3반만
      // 이름 찾기: 전체(또는 그 반)에서 이름이 들어간 기록을 순위와 함께 (최대 50명)
      const q = String(req.query.q || '').trim();
      if (q) {
        if (q.length > 8) return send(res, 400, { error: 'bad-query' });
        let all = parseMembers(await redis(['ZRANGE', key, 0, -1]), school);
        if (cls) all = onlyClass(all, cls);
        const matches = [];
        const ranked = rankList(all, 'river', 0, 1);
        for (let i = 0; i < ranked.length && matches.length < 50; i++) {
          if (String(ranked[i].name).includes(q)) matches.push(ranked[i]);
        }
        return send(res, 200, { matches, total: cls ? all.length : total });
      }
      // 쪽 나누기: offset부터 limit개 (기본 첫 10명)
      const offset = Math.min(Math.max(parseInt(req.query.offset, 10) || 0, 0), KEEP);
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || PAGE_DEFAULT, 1), PAGE_MAX);
      if (cls) {   // 한 반만: 전체를 읽어서 걸러요
        const mine = onlyClass(parseMembers(await redis(['ZRANGE', key, 0, -1]), school), cls);
        return send(res, 200, { top: rankList(mine, 'river', 0, 1).slice(offset, offset + limit), total: mine.length, offset });
      }
      const rows = parseMembers(await redis(['ZRANGE', key, offset, offset + limit - 1]), school);
      const top = rows.length ? rankList(rows, 'river', offset, await tieRank(redis, key, rankValue('river', rows[0]))) : rows;
      return send(res, 200, { top, total, offset });
    }

    if (req.method === 'POST') {
      let b = req.body;
      if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = null; } }
      if (!b || !(await validYearSchool(b.year, b.school))) return send(res, 400, { error: 'bad-request' });

      const name = String(b.name || '').replace(/[<>\s\u0000-\u001f]/g, '').slice(0, 8);   // 띄어쓰기 없이
      const rolls = Number(b.rolls);
      const id = String(b.id || '');
      const setup = b.setup;
      if (!name || badName(name)) return send(res, 400, { error: 'bad-name' });
      if (!/^[a-z0-9]{4,16}$/.test(id)) return send(res, 400, { error: 'bad-id' });
      // 토큰 12개를 모두 부수려면 최소 12번은 굴려야 해요
      if (!Number.isInteger(rolls) || rolls < 12 || rolls > 2000) return send(res, 400, { error: 'bad-rolls' });
      if (!Array.isArray(setup) || setup.length !== 12 || !setup.every(n => Number.isInteger(n) && n >= 0 && n <= 12)
          || setup.reduce((x, y) => x + y, 0) !== 12) return send(res, 400, { error: 'bad-setup' });
      // 1번 칸은 주사위 합이 될 수 없어서, 거기에 토큰이 있으면 이길 수 없어요
      if (setup[0] !== 0) return send(res, 400, { error: 'bad-setup' });

      const key = 'rd:' + Number(b.year) + ':' + b.school;
      const ts = Date.now();
      const uid = /^[a-f0-9]{32}$/.test(String(b.uid || '')) ? String(b.uid) : undefined;   // 기기별 익명 번호 (없어도 돼요)
      const gr = Number(b.gr), cl = Number(b.cl), cls = isClass(gr, cl) ? { gr, cl } : {};   // 학년·반 (번호는 받지 않아요)
      const member = JSON.stringify(Object.assign({ id, name, rolls, setup, ts, uid }, cls));
      const score = rolls - ts / 1e13; // 굴린 횟수가 같으면 최근에 기록한 사람이 위
      await redis(['ZADD', key, score, member]);
      const rank0 = await redis(['ZRANK', key, member]);
      const myRank = rank0 == null ? KEEP + 1 : await tieRank(redis, key, rolls);   // 같은 횟수는 공동 순위
      await redis(['ZREMRANGEBYRANK', key, KEEP, -1]);
      const topRows = parseMembers(await redis(['ZRANGE', key, 0, PAGE_DEFAULT - 1]), b.school);
      const top = rankList(topRows, 'river', 0, 1);
      const total = Number(await redis(['ZCARD', key])) || 0;
      return send(res, 200, { rank: myRank, top, total });
    }

    if (req.method === 'DELETE') {
      if (!isAdmin(req)) return send(res, 401, { error: 'unauthorized' });
      const { year, school, id } = req.query;
      if (!(await validYearSchool(year, school))) return send(res, 400, { error: 'bad-request' });
      const key = 'rd:' + Number(year) + ':' + school;
      // all=1 이면 이 학교·학년도의 순위 기록을 모두 지워요
      if (req.query.all === '1') {
        const n = Number(await redis(['ZCARD', key])) || 0;
        await redis(['DEL', key]);
        return send(res, 200, { removed: n });
      }
      // ids=a,b,c 로 여러 건을 한 번에 지울 수 있어요 (한 번에 100건까지)
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
