// POST /api/users — 회원 관리 (센터 관리자 전용)
//  {op:'list'}                                         → 계정 목록 + 등록 신청 목록
//  {op:'create', id, name, role, org?, phone?, memo?, expiresAt?, sup?, driverId?, sid?, pw?}
//  {op:'update', id, name?, role?, org?, phone?, memo?, expiresAt?, sup?, driverId?, sid?, active?}
//  {op:'reset_pw', id, pw?} · {op:'unlock', id} · {op:'delete', id}
//  {op:'bulk_create', items:[{id, name, role, org, phone, sup, driverId, sid, expiresAt}]}   (최대 200개)
//  {op:'bulk', action:'suspend'|'resume'|'unlock'|'reset_pw'|'delete', ids:[...]}       (최대 200개)
//  {op:'approve', rid, id, role, name?, org?, phone?, sup?, driverId?, sid?, expiresAt?} · {op:'reject', rid, reason?}
// 비밀번호는 PBKDF2 해시로만 저장하고 목록에도 내려주지 않는다. 발급·초기화한 비밀번호는 첫 로그인 때 바꾸게 한다.
// 임시 비밀번호를 비워 보내면 서버가 안전하게 만들어 응답에 한 번만 돌려준다.
const C = require('./_lib/core');
const ROLE_LABEL = {admin:'센터 관리자', staff:'센터 직원', viewer:'열람 전용', sup:'공급업체', driver:'배송 기사', school:'학교'};
const MAX_BULK = 200;
class Bad extends Error{constructor(m){super(m);this.code = 400;}}

async function adminCount(){const all = await C.listCol('users');return all.filter(x => x.data && x.data.role === 'admin' && x.data.active !== false).length;}
function links(b, role){
  const o = {sup:null, driverId:null, sid:null};
  if (role === 'sup'){o.sup = String(b.sup || '').trim().slice(0, 80);if (!o.sup) throw new Bad('공급업체 계정은 업체명을 지정해야 합니다.');}
  if (role === 'driver'){o.driverId = String(b.driverId || '').trim().slice(0, 40);if (!o.driverId) throw new Bad('기사 계정은 연결할 기사를 지정해야 합니다.');}
  if (role === 'school'){o.sid = String(b.sid || '').trim().slice(0, 20);if (!o.sid) throw new Bad('학교 계정은 학교를 지정해야 합니다.');}
  return o;
}
function normId(v){const id = String(v || '').trim().toLowerCase();if (!C.ID_OK.test(id)) throw new Bad('아이디는 영문 소문자·숫자로 3~32자입니다 (. _ - 사용 가능).');return id;}
function pickPw(v){
  const pw = v ? String(v).trim() : C.tempPw();
  if (!C.pwOk(pw)) throw new Bad('임시 비밀번호는 ' + C.PW_RULE + '이어야 합니다.');
  return pw;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return C.send(res, 405, {error:'method'});
  if (!C.configured() || !C.encReady()) return C.send(res, 503, {error:'storage_not_configured'});
  try{
    const me = await C.who(req);if (!me || me.role !== 'admin' || !me.uid) return C.send(res, 403, {error:'센터 관리자만 회원을 관리할 수 있습니다.'});
    const b = await C.body(req);const by = 'admin:' + me.uid;
    const log = (id, op) => C.ledger({at:Date.now(), col:'users', id, op, by, doc:null});

    // 새 계정 만들기 (단건·일괄·신청 승인 공통)
    async function createOne(src){
      const id = normId(src.id);
      if (await C.getDoc('users', id)) throw new Bad(`이미 있는 아이디입니다: ${id}`);
      const role = String(src.role || '');if (!C.ROLES.includes(role)) throw new Bad('역할을 고르세요.');
      const pw = pickPw(src.pw);
      const u = Object.assign({name:C.clip(src.name, 40) || id, role, active:true, tv:0, mustChange:true, createdAt:Date.now(), pwAt:Date.now(), by:me.uid, fail:0},
        C.profile(src), links(src, role), C.newHash(pw));
      await C.putDoc('users', id, u);if (role === 'admin') await C.redis(['SET', 'sys:admins', '1']);await log(id, 'create');
      return {id, pw, user:C.publicUser(id, u)};
    }
    // 권한·사용 변경 시 지켜야 할 규칙 (내 계정, 마지막 관리자)
    async function guard(id, u, next){
      if (id === me.uid && (next.role !== 'admin' || !next.active || next.del)) throw new Bad('내 계정의 관리자 권한은 여기서 내리거나 중지·삭제할 수 없습니다.');
      if (u.role === 'admin' && u.active !== false && (next.role !== 'admin' || !next.active || next.del) && await adminCount() <= 1) throw new Bad('마지막 관리자 계정입니다. 다른 관리자를 먼저 만드세요.');
    }

    if (b.op === 'list'){
      const all = await C.listCol('users');
      const reqs = (await C.listCol('user_req')).map(x => Object.assign({rid:x.id}, x.data)).filter(r => r.status === 'pending' || Date.now() - (r.doneAt || r.at || 0) < 30 * 864e5).sort((a, z) => (z.at || 0) - (a.at || 0));
      return C.send(res, 200, {users:all.map(x => C.publicUser(x.id, x.data)).sort((a, z) => a.id.localeCompare(z.id)), roles:ROLE_LABEL, requests:reqs,
        rule:{pw:C.PW_RULE, lockFails:C.LOCK_FAILS, pwMaxDays:Math.round(C.PW_MAX_AGE / 864e5)}});
    }
    if (b.op === 'create'){const r = await createOne(b);return C.send(res, 200, {ok:true, user:r.user, pw:r.pw});}

    if (b.op === 'bulk_create'){
      const items = Array.isArray(b.items) ? b.items.slice(0, MAX_BULK) : [];if (!items.length) throw new Bad('등록할 계정이 없습니다.');
      const out = [];const seen = new Set();
      for (const it of items){
        const idRaw = String(it.id || '').trim().toLowerCase();
        try{if (seen.has(idRaw)) throw new Bad('목록 안에 같은 아이디가 있습니다.');seen.add(idRaw);
          const r = await createOne(Object.assign({}, it, {pw:null}));out.push({id:r.id, ok:true, pw:r.pw, name:r.user.name, role:r.user.role});}
        catch(e){if (e.code !== 400) throw e;out.push({id:idRaw, ok:false, error:e.message});}
      }
      return C.send(res, 200, {ok:true, results:out});
    }

    if (b.op === 'bulk'){
      const ids = Array.isArray(b.ids) ? [...new Set(b.ids.map(x => String(x).toLowerCase()))].slice(0, MAX_BULK) : [];
      const act = String(b.action || '');if (!['suspend', 'resume', 'unlock', 'reset_pw', 'delete'].includes(act)) throw new Bad('처리 방법을 고르세요.');
      const out = [];
      for (const id of ids){
        try{
          const u = await C.getDoc('users', id);if (!u) throw new Bad('없는 계정입니다.');
          if (act === 'suspend'){await guard(id, u, {role:u.role, active:false});u.active = false;u.tv = (u.tv || 0) + 1;}
          if (act === 'resume'){u.active = true;u.tv = (u.tv || 0) + 1;}
          if (act === 'unlock'){u.fail = 0;u.lockedAt = null;}
          let pw;
          if (act === 'reset_pw'){if (id === me.uid) throw new Bad('내 비밀번호는 「내 계정」에서 바꾸세요.');pw = C.tempPw();Object.assign(u, C.newHash(pw), {mustChange:true, pwAt:Date.now(), fail:0, lockedAt:null, tv:(u.tv || 0) + 1});}
          if (act === 'delete'){await guard(id, u, {role:u.role, active:u.active !== false, del:true});await C.delDoc('users', id);await log(id, 'delete');out.push({id, ok:true});continue;}
          u.updatedAt = Date.now();await C.putDoc('users', id, u);
          await log(id, {suspend:'update', resume:'update', unlock:'unlock', reset_pw:'reset_pw'}[act]);
          out.push(pw ? {id, ok:true, pw, name:u.name} : {id, ok:true});
        }catch(e){if (e.code !== 400) throw e;out.push({id, ok:false, error:e.message});}
      }
      return C.send(res, 200, {ok:true, results:out});
    }

    if (b.op === 'approve' || b.op === 'reject'){
      const rid = String(b.rid || '');if (!/^[a-z0-9]{6,30}$/.test(rid)) throw new Bad('신청을 찾을 수 없습니다.');
      const r = await C.getDoc('user_req', rid);if (!r || r.status !== 'pending') throw new Bad('이미 처리했거나 없는 신청입니다.');
      if (b.op === 'reject'){Object.assign(r, {status:'rejected', doneAt:Date.now(), doneBy:me.uid, note:C.clip(b.reason, 200)});await C.putDoc('user_req', rid, r);await log(r.wantId || rid, 'reject');return C.send(res, 200, {ok:true});}
      const made = await createOne(Object.assign({name:r.name, org:r.org, phone:r.phone, memo:r.reason ? '신청 사유: ' + r.reason : ''}, b, {pw:null}));
      Object.assign(r, {status:'approved', doneAt:Date.now(), doneBy:me.uid, uid:made.id});await C.putDoc('user_req', rid, r);await log(made.id, 'approve');
      return C.send(res, 200, {ok:true, user:made.user, pw:made.pw});
    }

    const id = normId(b.id);
    const u = await C.getDoc('users', id);if (!u) return C.send(res, 404, {error:'없는 계정입니다.'});
    if (b.op === 'update'){
      const role = b.role != null ? String(b.role) : u.role;if (!C.ROLES.includes(role)) throw new Bad('역할을 고르세요.');
      const active = b.active != null ? !!b.active : u.active !== false;
      await guard(id, u, {role, active});
      const changedAccess = role !== u.role || active !== (u.active !== false);
      Object.assign(u, {name:b.name != null ? C.clip(b.name, 40) || id : u.name, role, active, updatedAt:Date.now()}, C.profile(b, u), links(Object.assign({}, u, b), role));
      if (changedAccess) u.tv = (u.tv || 0) + 1; // 권한이 바뀌면 기존 로그인 세션 끊기
      if (role === 'admin' && active) await C.redis(['SET', 'sys:admins', '1']);
      await C.putDoc('users', id, u);await log(id, 'update');return C.send(res, 200, {ok:true, user:C.publicUser(id, u)});
    }
    if (b.op === 'reset_pw'){
      const pw = pickPw(b.pw);
      Object.assign(u, C.newHash(pw), {mustChange:id !== me.uid, pwAt:Date.now(), fail:0, lockedAt:null, tv:(u.tv || 0) + 1, updatedAt:Date.now()});await C.putDoc('users', id, u);await log(id, 'reset_pw');
      return C.send(res, 200, {ok:true, pw});
    }
    if (b.op === 'unlock'){Object.assign(u, {fail:0, lockedAt:null, updatedAt:Date.now()});await C.putDoc('users', id, u);await log(id, 'unlock');return C.send(res, 200, {ok:true});}
    if (b.op === 'delete'){
      await guard(id, u, {role:u.role, active:u.active !== false, del:true});
      await C.delDoc('users', id);await log(id, 'delete');return C.send(res, 200, {ok:true});
    }
    return C.send(res, 400, {error:'op'});
  }catch(e){if (e.code === 400) return C.send(res, 400, {error:e.message});console.error('[api]', e);return C.send(res, 500, {error:'server'});}
};
