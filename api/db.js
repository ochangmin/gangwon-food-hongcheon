// POST /api/db  {op:'get'|'list'|'set'|'update'|'delete', path?, col?, data?, where?}
const C = require('./_lib/core');
const P = require('./_lib/policy');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return C.send(res, 405, {error:'method'});
  if (!C.configured()) return C.send(res, 503, {error:'storage_not_configured'});
  if (!C.encReady()) return C.send(res, 503, {error:'encryption_key_missing'});
  try{
    const u = await C.who(req);if (!u) return C.send(res, 401, {error:'login'});
    const b = await C.body(req);const op = b.op;
    if (op === 'list'){
      const col = String(b.col || '');if (!C.COL_RE.test(col) || col === 'sys') return C.send(res, 400, {error:'col'});
      let docs = await C.listCol(col);
      docs = docs.filter(d => P.canRead(u, col, d.id, d.data));
      if (Array.isArray(b.where) && b.where.length === 3 && b.where[1] === '==') docs = docs.filter(d => d.data && d.data[b.where[0]] === b.where[2]);
      const lim = Math.min(1000, Math.max(1, +b.limit || 500));
      return C.send(res, 200, {docs:docs.slice(0, lim).map(d => ({id:d.id, data:P.strip(col, d.data)}))});
    }
    const pp = C.splitPath(b.path);if (!pp) return C.send(res, 400, {error:'path'});
    const {col, id} = pp;
    const prev = await C.getDoc(col, id);
    if (op === 'get'){
      if (!prev || !P.canRead(u, col, id, prev)) return C.send(res, 200, {exists:false});
      return C.send(res, 200, {exists:true, data:P.strip(col, prev)});
    }
    if (op === 'set' || op === 'update' || op === 'delete'){
      let next = null;
      if (op === 'set') next = b.data || {};
      if (op === 'update'){if (!prev) return C.send(res, 404, {error:'not_found'});next = Object.assign({}, prev, b.data || {});}
      if (JSON.stringify(next || {}).length > 400000) return C.send(res, 413, {error:'too_large'});
      const chk = P.canWrite(u, col, id, next, prev, op);
      if (!chk.ok) return C.send(res, 403, {error:'permission-denied', why:chk.why});
      if (op === 'delete') await C.delDoc(col, id);
      else {const d = chk.data;// 비밀번호 해시는 덮어쓰기 시 유지
        if ((col === 'auth' || col === 'sup_auth') && prev && !d.hash){d.hash = prev.hash;d.salt = prev.salt;d.iter = prev.iter;}
        await C.putDoc(col, id, d);}
      // 변경 원장에 기록 (비밀번호 문서는 내용 해시 없이 기록만)
      const secretCol = col === 'auth' || col === 'sup_auth';
      await C.ledger({at:Date.now(), col, id, op, by:u.role + ':' + u.sub, doc:op === 'delete' || secretCol ? null : C.sha256(JSON.stringify(chk.data))});
      return C.send(res, 200, {ok:true});
    }
    return C.send(res, 400, {error:'op'});
  }catch(e){return C.send(res, 500, {error:'server', message:String(e.message || e).slice(0, 200)});}
};
