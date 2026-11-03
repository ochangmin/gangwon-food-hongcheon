// POST /api/users — 회원 관리 (센터 관리자 전용)
//  {op:'list'} · {op:'create', id, name, role, sup?, driverId?, sid?, pw} · {op:'update', id, name?, role?, sup?, driverId?, sid?, active?}
//  {op:'reset_pw', id, pw} · {op:'delete', id}
// 비밀번호는 PBKDF2 해시로만 저장하고 목록에도 내려주지 않는다. 발급·초기화한 비밀번호는 첫 로그인 때 바꾸게 한다.
const C = require('./_lib/core');
const ROLE_LABEL = {admin:'센터 관리자', staff:'센터 직원', viewer:'열람 전용', sup:'공급업체', driver:'배송 기사', school:'학교'};
async function adminCount(){const all = await C.listCol('users');return all.filter(x => x.data && x.data.role === 'admin' && x.data.active !== false).length;}
function links(b, role){
  const o = {sup:null, driverId:null, sid:null};
  if (role === 'sup'){o.sup = String(b.sup || '').trim().slice(0, 80);if (!o.sup) throw Object.assign(new Error('공급업체 계정은 업체명을 지정해야 합니다.'), {code:400});}
  if (role === 'driver'){o.driverId = String(b.driverId || '').trim().slice(0, 40);if (!o.driverId) throw Object.assign(new Error('기사 계정은 연결할 기사를 지정해야 합니다.'), {code:400});}
  if (role === 'school'){o.sid = String(b.sid || '').trim().slice(0, 20);if (!o.sid) throw Object.assign(new Error('학교 계정은 학교를 지정해야 합니다.'), {code:400});}
  return o;
}
module.exports = async (req, res) => {
  if (req.method !== 'POST') return C.send(res, 405, {error:'method'});
  if (!C.configured() || !C.encReady()) return C.send(res, 503, {error:'storage_not_configured'});
  try{
    const me = await C.who(req);if (!me || me.role !== 'admin' || !me.uid) return C.send(res, 403, {error:'센터 관리자만 회원을 관리할 수 있습니다.'});
    const b = await C.body(req);const by = 'admin:' + me.uid;
    const id = String(b.id || '').trim().toLowerCase();
    const log = op => C.ledger({at:Date.now(), col:'users', id, op, by, doc:null});
    if (b.op === 'list'){const all = await C.listCol('users');return C.send(res, 200, {users:all.map(x => C.publicUser(x.id, x.data)).sort((a, z) => a.id.localeCompare(z.id)), roles:ROLE_LABEL});}
    if (!C.ID_OK.test(id)) return C.send(res, 400, {error:'아이디는 영문 소문자·숫자로 3~32자입니다 (. _ - 사용 가능).'});
    if (b.op === 'create'){
      if (await C.getDoc('users', id)) return C.send(res, 409, {error:'이미 있는 아이디입니다.'});
      const role = String(b.role || '');if (!C.ROLES.includes(role)) return C.send(res, 400, {error:'역할을 고르세요.'});
      if (!C.pwOk(b.pw)) return C.send(res, 400, {error:'임시 비밀번호는 영문·숫자를 섞어 10자 이상이어야 합니다.'});
      const u = Object.assign({name:String(b.name || '').trim().slice(0, 40) || id, role, active:true, tv:0, mustChange:true, createdAt:Date.now(), by:me.uid}, links(b, role), C.newHash(b.pw));
      await C.putDoc('users', id, u);if (role === 'admin') await C.redis(['SET', 'sys:admins', '1']);await log('create');
      return C.send(res, 200, {ok:true, user:C.publicUser(id, u)});
    }
    const u = await C.getDoc('users', id);if (!u) return C.send(res, 404, {error:'없는 계정입니다.'});
    if (b.op === 'update'){
      const role = b.role != null ? String(b.role) : u.role;if (!C.ROLES.includes(role)) return C.send(res, 400, {error:'역할을 고르세요.'});
      const active = b.active != null ? !!b.active : u.active !== false;
      if (id === me.uid && (role !== 'admin' || !active)) return C.send(res, 400, {error:'내 계정의 관리자 권한은 여기서 내리거나 중지할 수 없습니다.'});
      if (u.role === 'admin' && (role !== 'admin' || !active) && await adminCount() <= 1) return C.send(res, 400, {error:'마지막 관리자 계정입니다.'});
      const changedAccess = role !== u.role || active !== (u.active !== false);
      Object.assign(u, {name:b.name != null ? String(b.name).trim().slice(0, 40) || id : u.name, role, active}, links(Object.assign({}, u, b), role));
      if (changedAccess) u.tv = (u.tv || 0) + 1; // 권한이 바뀌면 기존 로그인 세션 끊기
      await C.putDoc('users', id, u);await log('update');return C.send(res, 200, {ok:true, user:C.publicUser(id, u)});
    }
    if (b.op === 'reset_pw'){
      if (!C.pwOk(b.pw)) return C.send(res, 400, {error:'임시 비밀번호는 영문·숫자를 섞어 10자 이상이어야 합니다.'});
      Object.assign(u, C.newHash(b.pw), {mustChange:id !== me.uid, tv:(u.tv || 0) + 1});await C.putDoc('users', id, u);await log('reset_pw');
      return C.send(res, 200, {ok:true});
    }
    if (b.op === 'delete'){
      if (id === me.uid) return C.send(res, 400, {error:'내 계정은 지울 수 없습니다.'});
      if (u.role === 'admin' && await adminCount() <= 1) return C.send(res, 400, {error:'마지막 관리자 계정입니다.'});
      await C.delDoc('users', id);await log('delete');return C.send(res, 200, {ok:true});
    }
    return C.send(res, 400, {error:'op'});
  }catch(e){if (e.code === 400) return C.send(res, 400, {error:e.message});console.error('[api]', e);return C.send(res, 500, {error:'server'});}
};
