// POST /api/ledger  {op:'verify'} | {op:'tail', n}  — 센터 관리자 전용: 변경 원장 무결성 검증·최근 기록
const C = require('./_lib/core');
module.exports = async (req, res) => {
  if (req.method !== 'POST') return C.send(res, 405, {error:'method'});
  if (!C.configured() || !C.encReady()) return C.send(res, 503, {error:'storage_not_configured'});
  try{
    const u = await C.who(req);if (!u || u.role !== 'admin') return C.send(res, 401, {error:'login'});
    const b = await C.body(req);
    if (b.op === 'verify') return C.send(res, 200, await C.ledgerVerify());
    if (b.op === 'tail') return C.send(res, 200, {rows:await C.ledgerTail(Math.min(200, Math.max(1, +b.n || 30)))});
    return C.send(res, 400, {error:'op'});
  }catch(e){return C.send(res, 500, {error:'server', message:String(e.message || e).slice(0, 200)});}
};
