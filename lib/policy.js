// 역할별 권한 — 서버가 직접 판단한다 (브라우저 화면 제한과 별개)
//  admin  : 센터 관리자 — 모든 컬렉션 읽기·쓰기
//  sup    : 공급업체 — 자기 업체 출고 문서(sup_ship)만 읽기·쓰기, 출고확정 이후·입고 항목은 변경 불가
//  driver : 배송 기사 — 자기 운행(runs), 자기 차량 단말 명령(iot_cmd) 응답·센서값(iot_tel)만 쓰기
// 비밀번호 해시(auth, sup_auth, sys)는 누구에게도 내려주지 않는다.

const SHARED_READ = ['orders', 'std_center', 'std_custom', 'courses'];
const HIDDEN_FIELDS = {auth:['salt', 'hash', 'iter'], sup_auth:['salt', 'hash', 'iter']};
const SUP_STATUS = ['발주접수', '출고준비', '출고확정'];

// 화면의 supKey(날짜, 업체명)와 같은 규칙
function supHash(name){let h = 0;for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0;return h.toString(36);}

function strip(col, data){
  const h = HIDDEN_FIELDS[col];if (!h || !data) return data;const o = Object.assign({}, data);h.forEach(k => delete o[k]);return o;
}

function canRead(u, col, id, data){
  if (!u) return false;
  if (u.role === 'admin') return true;
  if (SHARED_READ.includes(col)) return true;
  if (u.role === 'sup'){
    if (col === 'sup_ship') return !!data && data.kind !== 'out' && data.sup === u.sup;
    return false;
  }
  if (u.role === 'driver'){
    if (['drivers', 'runs', 'sup_ship'].includes(col)) return true;
    if (col === 'auth') return id === u.sub; // 해시는 strip 으로 제거, at 만 보냄
    if (col === 'iot_cmd') return !!data && data.vid === u.veh;
    if (col === 'iot_tel') return id === u.veh;
    return false;
  }
  return false;
}

// 반환: {ok:true, data(저장할 최종 문서)} 또는 {ok:false, why}
function canWrite(u, col, id, next, prev, op){
  if (!u) return {ok:false, why:'login'};
  if (col === 'sys') return {ok:false, why:'reserved'};
  if (u.role === 'admin') return {ok:true, data:next};
  if (u.role === 'sup'){
    if (col !== 'sup_ship' || op === 'delete') return {ok:false, why:'sup_scope'};
    if (!next || next.kind === 'out' || next.sup !== u.sup) return {ok:false, why:'other_supplier'};
    if (prev && prev.sup !== u.sup) return {ok:false, why:'other_supplier'};
    if (!String(id).endsWith('_' + supHash(u.sup))) return {ok:false, why:'other_supplier'};
    if (prev && !SUP_STATUS.slice(0, 2).includes(prev.status)) return {ok:false, why:'locked_after_confirm'};
    if (!SUP_STATUS.includes(next.status)) return {ok:false, why:'status_not_allowed'};
    // 센터 입고(검수) 항목은 업체가 바꿀 수 없음
    const items = {};Object.entries(next.items || {}).forEach(([k, x]) => {const p = (prev && prev.items && prev.items[k]) || {};items[k] = Object.assign({}, x, {rcv:p.rcv, bad:p.bad});if (items[k].rcv === undefined) delete items[k].rcv;if (items[k].bad === undefined) delete items[k].bad;});
    const d = Object.assign({}, next, {items, by:'sup:' + u.sub});delete d.recvAt;delete d.rcvTemp;
    return {ok:true, data:d};
  }
  if (u.role === 'driver'){
    if (col === 'runs'){if (op === 'delete' || !next || next.driverId !== u.sub || (prev && prev.driverId !== u.sub)) return {ok:false, why:'not_your_run'};return {ok:true, data:next};}
    if (col === 'iot_cmd'){
      if (!prev || prev.vid !== u.veh || op === 'delete') return {ok:false, why:'not_your_vehicle'};
      const d = Object.assign({}, prev);['step', 'status', 'steps', 'result', 'relayBy', 'err'].forEach(k => {if (next && k in next) d[k] = next[k];});d.relayBy = u.sub;
      return {ok:true, data:d};
    }
    if (col === 'iot_tel'){if (id !== u.veh || op === 'delete') return {ok:false, why:'not_your_vehicle'};return {ok:true, data:Object.assign({}, next, {by:u.sub})};}
    return {ok:false, why:'driver_scope'};
  }
  return {ok:false, why:'role'};
}

module.exports = {canRead, canWrite, strip};
