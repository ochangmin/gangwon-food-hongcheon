// POST /api/auth — 회원 로그인 (계정은 users/{아이디}, 센터 관리자가 발급)
//  {op:'status'}                              → 저장소·암호화 준비 여부, 최초 관리자 필요 여부
//  {op:'setup', setupCode, id, name, pw}      → 최초 1회: 관리자 계정 만들기 (발급된 최초 설정 코드 필요)
//  {op:'login', id, pw}                       → 로그인 (HttpOnly 세션 쿠키 + 토큰)
//  {op:'me'}                                  → 지금 로그인한 계정
//  {op:'change_pw', pw, newPw}                → 내 비밀번호 바꾸기
//  {op:'logout'}                              → 로그아웃 (쿠키 삭제)
//  {op:'recover', setupCode, id, newPw}      → 계정 복구: 최초 설정 코드로 잠금 해제 + 새 비밀번호 (없는 아이디면 관리자 아이디 안내)
//  {op:'request', name, org, phone, wantId, role, reason} → 계정 등록 신청 (로그인 없이, 관리자 승인 후 발급)
const crypto = require('crypto');
const C = require('./_lib/core');

async function issue(res, id, u){
  const claims = {uid:id, role:u.role, name:u.name || id, sup:u.sup || null, sid:u.sid || null, tv:u.tv || 0, exp:Date.now() + C.SESSION_MS};
  if (u.role === 'driver' && u.driverId){claims.sub = u.driverId;claims.driverId = u.driverId;const d = await C.getDoc('drivers', u.driverId).catch(() => null);claims.veh = d && d.veh || null;}
  else claims.sub = id;
  const token = await C.sign(claims);
  res.setHeader('Set-Cookie', C.sessionCookie(token, Math.floor(C.SESSION_MS / 1000)));
  return Object.assign({token, id, exp:claims.exp}, C.publicUser(id, u), {veh:claims.veh || null});
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return C.send(res, 405, {error:'method'});
  const b = await C.body(req);
  if (b.op === 'status'){
    if (!C.configured() || !C.encReady()) return C.send(res, 200, {configured:false});
    try{const n = Number(await C.redis(['GET', 'sys:admins']) || 0);return C.send(res, 200, {configured:true, setupNeeded:n < 1});}
    catch(e){console.error('[auth]', e);return C.send(res, 200, {configured:false});}
  }
  if (b.op === 'logout'){res.setHeader('Set-Cookie', C.sessionCookie('', 0));return C.send(res, 200, {ok:true});}
  if (!C.configured() || !C.encReady()) return C.send(res, 503, {error:'회원 저장소가 아직 연결되지 않았습니다.'});
  const bad = () => C.send(res, 401, {error:'아이디 또는 비밀번호가 맞지 않습니다. 관리자에게 문의하세요.'});
  try{
    if (b.op === 'setup'){
      if (!(await C.rateOk(req, 'setup'))) return C.send(res, 429, {error:'시도가 많습니다. 10분 뒤 다시 시도하세요.'});
      if (!C.setupCodeOk(b.setupCode)) return C.send(res, 401, {error:'최초 설정 코드가 맞지 않습니다.'});
      if (Number(await C.redis(['GET', 'sys:admins']) || 0) > 0) return C.send(res, 409, {error:'이미 관리자 계정이 있습니다. 로그인하세요.'});
      const id = String(b.id || '').trim().toLowerCase();
      if (!C.ID_OK.test(id)) return C.send(res, 400, {error:'아이디는 영문 소문자·숫자로 3~32자입니다.'});
      if (!C.pwOk(b.pw)) return C.send(res, 400, {error:'비밀번호는 ' + C.PW_RULE + '이어야 합니다.'});
      const u = Object.assign({name:String(b.name || '센터 관리자').slice(0, 40), role:'admin', active:true, tv:0, createdAt:Date.now(), lastLogin:Date.now(), pwAt:Date.now(), by:'setup'}, C.newHash(b.pw));
      await C.putDoc('users', id, u);await C.redis(['SET', 'sys:admins', '1']);
      await C.ledger({at:Date.now(), col:'users', id, op:'setup', by:'setup', doc:null});
      return C.send(res, 200, await issue(res, id, u));
    }
    if (b.op === 'login'){
      const id = String(b.id || '').trim().toLowerCase();
      if (!(await C.rateOk(req, 'login:' + id))) return C.send(res, 429, {error:'로그인 시도가 많습니다. 10분 뒤 다시 시도하세요.'});
      if (!C.ID_OK.test(id)) return bad();
      const u = await C.getDoc('users', id);
      const ipm = String(req.headers['x-vercel-forwarded-for'] || req.headers['x-real-ip'] || '').split(',')[0].trim().replace(/\.\d+$/, '.*');
      if (u && u.lockedAt) return C.send(res, 423, {error:`비밀번호를 ${C.LOCK_FAILS}회 틀려 잠긴 계정입니다. 관리자에게 잠금 해제를 요청하세요.`});
      if (!u || !C.checkPw(b.pw, u)){
        if (u){
          u.fail = (u.fail || 0) + 1;
          const lockNow = u.fail >= C.LOCK_FAILS;if (lockNow) u.lockedAt = Date.now();
          await C.putDoc('users', id, u);
          await C.ledger({at:Date.now(), col:'users', id, op:'login_fail', by:ipm || '-', doc:null});
          if (lockNow){await C.ledger({at:Date.now(), col:'users', id, op:'lock', by:'system', doc:null});
            return C.send(res, 423, {error:`비밀번호를 ${C.LOCK_FAILS}회 틀려 계정이 잠겼습니다. 관리자에게 잠금 해제를 요청하세요.`});}
          if (u.fail >= C.LOCK_FAILS - 2) return C.send(res, 401, {error:`아이디 또는 비밀번호가 맞지 않습니다. ${C.LOCK_FAILS - u.fail}번 더 틀리면 계정이 잠깁니다.`});
        }
        return bad();
      }
      if (u.active === false) return C.send(res, 403, {error:'사용이 중지된 계정입니다. 관리자에게 문의하세요.'});
      if (u.expiresAt && Date.now() > u.expiresAt) return C.send(res, 403, {error:'사용 기한이 지난 계정입니다. 관리자에게 연장을 요청하세요.'});
      const prev = {prevLogin:u.lastLogin || null, prevIp:u.lastIp || null};
      const pwExpired = !u.mustChange && Date.now() - (u.pwAt || u.createdAt || 0) > C.PW_MAX_AGE;
      if (pwExpired) u.mustChange = true; // 90일이 지나면 로그인 직후 비밀번호를 바꾸게 한다
      u.fail = 0;u.lastLogin = Date.now();u.lastIp = ipm || null;await C.putDoc('users', id, u);
      await C.ledger({at:Date.now(), col:'users', id, op:'login', by:ipm || '-', doc:null});
      return C.send(res, 200, Object.assign(await issue(res, id, u), prev, {pwExpired}));
    }
    if (b.op === 'recover'){
      if (!(await C.rateOk(req, 'recover'))) return C.send(res, 429, {error:'시도가 많습니다. 10분 뒤 다시 시도하세요.'});
      if (!C.setupCodeOk(b.setupCode)){await C.ledger({at:Date.now(), col:'users', id:String(b.id || '').slice(0, 32), op:'recover_fail', by:C.clientIp(req).replace(/\.\d+$/, '.*'), doc:null});return C.send(res, 401, {error:'최초 설정 코드가 맞지 않습니다.'});}
      const id = String(b.id || '').trim().toLowerCase();
      const u = C.ID_OK.test(id) ? await C.getDoc('users', id) : null;
      if (!u){ // 설정 코드가 맞으면 실제 관리자 아이디를 알려 준다 (코드 보유자 = 비상 관리자)
        const ad = (await C.listCol('users')).filter(x => x.data && x.data.role === 'admin').map(x => x.id + (x.data.active === false ? '(중지)' : x.data.lockedAt ? '(잠김)' : ''));
        return C.send(res, 404, {error:`'${id}' 계정이 없습니다. ` + (ad.length ? '센터 관리자 아이디: ' + ad.join(', ') : '관리자 계정이 없습니다.'), admins:ad});
      }
      if (!C.pwOk(b.newPw)) return C.send(res, 400, {error:'새 비밀번호는 ' + C.PW_RULE + '이어야 합니다.'});
      Object.assign(u, C.newHash(b.newPw), {active:true, fail:0, lockedAt:null, mustChange:false, pwAt:Date.now(), tv:(u.tv || 0) + 1, updatedAt:Date.now()});
      await C.putDoc('users', id, u);await C.redis(['SET', 'sys:admins', '1']);
      await C.ledger({at:Date.now(), col:'users', id, op:'recover', by:C.clientIp(req).replace(/\.\d+$/, '.*'), doc:null});
      return C.send(res, 200, await issue(res, id, u));
    }
    if (b.op === 'request'){
      if (!(await C.rateOk(req, 'request'))) return C.send(res, 429, {error:'신청이 많습니다. 10분 뒤 다시 시도하세요.'});
      const name = C.clip(b.name, 40), org = C.clip(b.org, 60), phone = C.clip(b.phone, 20).replace(/[^0-9+\-() ]/g, ''), reason = C.clip(b.reason, 200);
      const role = ['staff', 'viewer', 'sup', 'driver', 'school'].includes(b.role) ? b.role : 'viewer';
      const wantId = String(b.wantId || '').trim().toLowerCase();
      if (!name || !org || phone.replace(/[^0-9]/g, '').length < 8) return C.send(res, 400, {error:'이름, 소속, 연락처를 정확히 적어 주세요.'});
      if (wantId && !C.ID_OK.test(wantId)) return C.send(res, 400, {error:'희망 아이디는 영문 소문자·숫자로 3~32자입니다.'});
      const pend = (await C.listCol('user_req')).filter(x => x.data && x.data.status === 'pending');
      if (pend.length >= 100) return C.send(res, 429, {error:'처리를 기다리는 신청이 많습니다. 센터에 문의하세요.'});
      const rid = Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
      await C.putDoc('user_req', rid, {name, org, phone, wantId, role, reason, status:'pending', at:Date.now(), ip:C.clientIp(req).replace(/\.\d+$/, '.*')});
      await C.ledger({at:Date.now(), col:'users', id:wantId || rid, op:'request', by:'public', doc:null});
      return C.send(res, 200, {ok:true, rid});
    }
    const me = await C.who(req);if (!me || !me.uid) return C.send(res, 401, {error:'login'});
    if (b.op === 'me'){const u = await C.getDoc('users', me.uid);return C.send(res, 200, Object.assign(C.publicUser(me.uid, u), {exp:me.exp}));}
    if (b.op === 'update_me'){const u = await C.getDoc('users', me.uid);u.name = String(b.name || '').trim().slice(0, 40) || me.uid;await C.putDoc('users', me.uid, u);return C.send(res, 200, C.publicUser(me.uid, u));}
    if (b.op === 'change_pw'){
      if (!(await C.rateOk(req, 'pw:' + me.uid))) return C.send(res, 429, {error:'시도가 많습니다. 10분 뒤 다시 시도하세요.'});
      const u = await C.getDoc('users', me.uid);
      if (!u || !C.checkPw(b.pw, u)) return C.send(res, 401, {error:'지금 비밀번호가 맞지 않습니다.'});
      if (!C.pwOk(b.newPw)) return C.send(res, 400, {error:'새 비밀번호는 ' + C.PW_RULE + '이어야 합니다.'});
      if (String(b.newPw) === String(b.pw)) return C.send(res, 400, {error:'지금과 다른 비밀번호를 정하세요.'});
      Object.assign(u, C.newHash(b.newPw), {mustChange:false, tv:(u.tv || 0) + 1, pwAt:Date.now()});await C.putDoc('users', me.uid, u);
      await C.ledger({at:Date.now(), col:'users', id:me.uid, op:'change_pw', by:me.role + ':' + me.uid, doc:null});
      return C.send(res, 200, await issue(res, me.uid, u)); // 비밀번호가 바뀌면 다른 기기의 세션은 끊기고 이 기기만 새 세션
    }
    return C.send(res, 400, {error:'op'});
  }catch(e){console.error('[api]', e);return C.send(res, 500, {error:'server'});}
};
