// 익명 접속 집계 API: 실험실 페이지를 열 때 lab-bar.js가 한 번 보내요.
//   POST /api/hit  {unit, code, name, uid}   (Content-Type: text/plain 으로 보내서 다른 주소에서도 사전 확인 없이 돼요)
// 받는 값은 '어느 실험실(unit)·어느 학교(코드·이름)·익명 번호(uid)'뿐이에요. 이름·학번·별명은 오지 않아요.
// 저장: 날짜(한국 시간)별로 횟수(해시)와 사용자 수(HyperLogLog, 같은 번호는 한 명으로 세요). 약 13개월 뒤 저절로 지워져요.
//   hc:<날짜>            해시  '실험실|학교코드' → 방문 횟수
//   hs                    해시  학교코드 → 학교 이름
//   hu:<날짜>:u:<실험실>  사용자 수 (실험실별)   hu:<날짜>:s:<학교코드> (학교별)   hu:<날짜>:all (전체)
const { configured, redisMulti, send, rateLimit, kstDay } = require('./_lib');
const UNITS = ['home', 'math', 'stat', 'prob', 'river', 'coin', 'sim', 'game'];
const TTL = 400 * 86400;


module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST, OPTIONS'); return send(res, 405, { error: 'method-not-allowed' }); }
  if (!configured()) return send(res, 503, { error: 'storage-not-configured' });
  try {
    let b = req.body;
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = null; } }
    if (!b || !UNITS.includes(b.unit)) return send(res, 400, { error: 'bad-request' });
    const code = /^\d{4,12}$/.test(String(b.code || '')) ? String(b.code) : '';
    const name = String(b.name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40);
    const uid = /^[a-f0-9]{32}$/.test(String(b.uid || '')) ? String(b.uid) : '';
    if (!(await rateLimit(req, 'hit', 600, 60))) return send(res, 429, { error: 'too-many' });   // 학교는 같은 IP를 쓰는 경우가 많아서 넉넉하게
    const day = kstDay();
    const cmds = [['HINCRBY', 'hc:' + day, b.unit + '|' + (code || '-'), 1], ['EXPIRE', 'hc:' + day, TTL]];
    if (code && name) cmds.push(['HSET', 'hs', code, name]);
    if (uid) {
      const ks = ['hu:' + day + ':u:' + b.unit, 'hu:' + day + ':all'];
      if (code) ks.push('hu:' + day + ':s:' + code);
      ks.forEach(k => { cmds.push(['PFADD', k, uid]); cmds.push(['EXPIRE', k, TTL]); });
    }
    await redisMulti(cmds);
    return send(res, 200, { ok: true });
  } catch (e) {
    return send(res, 500, { error: 'server-error' });
  }
};
