// POST /api/auth
//  {op:'status'}                         → 저장소 연결 여부, 관리자 설정 여부
//  {op:'setup', pw}                      → 최초 1회: 센터 관리자 비밀번호 설정 (관리자가 없을 때만)
//  {op:'login', role:'admin', pw}
//  {op:'login', role:'sup', id, pw}      → sup_auth/{id}
//  {op:'login', role:'driver', id, pw}   → drivers(loginId 또는 문서 id) + auth/{기사id}
//  {op:'admin_pw', pw, newPw}            → 관리자 비밀번호 변경
const C = require('./_lib/core');
const DAY = 12 * 3600e3;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return C.send(res, 405, {error:'method'});
  const b = await C.body(req);
  if (b.op === 'status'){
    if (!C.configured()) return C.send(res, 200, {configured:false});
    try{const a = await C.redis(['GET', 'sys:admin']);return C.send(res, 200, {configured:C.encReady(), storage:true, encryption:C.encReady(), hasAdmin:!!a});}
    catch(e){return C.send(res, 200, {configured:false, error:String(e.message).slice(0, 120)});}
  }
  if (!C.configured()) return C.send(res, 503, {error:'storage_not_configured'});
  if (!C.encReady()) return C.send(res, 503, {error:'암호화 키(DATA_ENC_KEY)가 설정되지 않았습니다.'});
  try{
    const bad = () => C.send(res, 401, {error:'아이디 또는 비밀번호가 맞지 않습니다. 관리자에게 문의하세요.'});
    if (b.op === 'setup'){
      if (!process.env.ADMIN_SETUP_CODE) return C.send(res, 403, {error:'최초 설정 코드(ADMIN_SETUP_CODE)가 서버에 설정되지 않았습니다.'});
      if (!(await C.rateOk(req, 'setup'))) return C.send(res, 429, {error:'시도가 많습니다. 10분 뒤 다시 시도하세요.'});
      if (!C.setupCodeOk(b.setupCode)) return C.send(res, 401, {error:'최초 설정 코드가 맞지 않습니다.'});
      if (!b.pw || String(b.pw).length < 10 || !/[A-Za-z]/.test(b.pw) || !/[0-9]/.test(b.pw)) return C.send(res, 400, {error:'관리자 비밀번호는 영문·숫자를 섞어 10자 이상이어야 합니다.'});
      if (!b.pw || String(b.pw).length < 8) return C.send(res, 400, {error:'관리자 비밀번호는 8자 이상이어야 합니다.'});
      const ok = await C.redis(['SET', 'sys:admin', JSON.stringify(C.newHash(b.pw)), 'NX']);
      if (!ok) return C.send(res, 409, {error:'이미 관리자 비밀번호가 설정되어 있습니다.'});
      return C.send(res, 200, {token:await C.sign({role:'admin', sub:'admin', exp:Date.now() + DAY}), role:'admin'});
    }
    if (b.op === 'login'){
      const role = b.role;const id = String(b.id || '').trim().toLowerCase();
      if (!(await C.rateOk(req, role + ':' + id))) return C.send(res, 429, {error:'로그인 시도가 많습니다. 10분 뒤 다시 시도하세요.'});
      if (role === 'admin'){
        const rec = JSON.parse(await C.redis(['GET', 'sys:admin']) || 'null');
        if (!rec || !C.checkPw(b.pw, rec)) return bad();
        return C.send(res, 200, {token:await C.sign({role:'admin', sub:'admin', exp:Date.now() + DAY}), role:'admin'});
      }
      if (role === 'sup'){
        const rec = await C.getDoc('sup_auth', id);
        if (!rec || !C.checkPw(b.pw, rec)) return bad();
        return C.send(res, 200, {token:await C.sign({role:'sup', sub:id, sup:rec.sup, exp:Date.now() + DAY}), role:'sup', sup:rec.sup, id});
      }
      if (role === 'driver'){
        const ds = await C.listCol('drivers');
        const d = ds.find(x => String((x.data && x.data.loginId) || x.id).toLowerCase() === id);
        if (!d) return bad();
        const rec = await C.getDoc('auth', d.id);
        if (!rec || !C.checkPw(b.pw, rec)) return bad();
        return C.send(res, 200, {token:await C.sign({role:'driver', sub:d.id, veh:d.data.veh || null, exp:Date.now() + DAY}), role:'driver', driverId:d.id, authAt:rec.at || null});
      }
      return C.send(res, 400, {error:'role'});
    }
    if (b.op === 'admin_pw'){
      const u = await C.who(req);if (!u || u.role !== 'admin') return C.send(res, 401, {error:'login'});
      const rec = JSON.parse(await C.redis(['GET', 'sys:admin']) || 'null');
      if (!rec || !C.checkPw(b.pw, rec)) return bad();
      if (!b.newPw || String(b.newPw).length < 10 || !/[A-Za-z]/.test(b.newPw) || !/[0-9]/.test(b.newPw)) return C.send(res, 400, {error:'새 비밀번호는 영문·숫자를 섞어 10자 이상이어야 합니다.'});
      await C.redis(['SET', 'sys:admin', JSON.stringify(C.newHash(b.newPw))]);
      return C.send(res, 200, {ok:true});
    }
    return C.send(res, 400, {error:'op'});
  }catch(e){console.error('[api]', e);return C.send(res, 500, {error:'server'});}
};
