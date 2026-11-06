'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { rpc, backOf, str, ids, withMsg } from '@/lib/act';
import { supabase, adminClient } from '@/lib/supabase/server';
import { requireCenter } from '@/lib/session';

/* 주문확정 */
export async function confirmAll(fd: FormData) {
  return rpc<{ confirmed: number }>('confirm_orders', { p_center_id: str(fd, 'center'), p_date: str(fd, 'date') }, backOf(fd), (d) => `${d.confirmed}건 주문확정 · 공급업체 발주 생성`);
}
export async function confirmSchools(fd: FormData) {
  const schools = ids(fd, 'school');
  if (!schools.length) redirect(withMsg(backOf(fd), 'err', '확정할 학교를 선택하세요'));
  return rpc<{ confirmed: number }>('confirm_orders', { p_center_id: str(fd, 'center'), p_date: str(fd, 'date'), p_school_ids: schools }, backOf(fd), (d) => `${d.confirmed}건 주문확정`);
}
export async function unconfirm(fd: FormData) {
  const lines = ids(fd);
  if (!lines.length) redirect(withMsg(backOf(fd), 'err', '확정취소할 품목을 선택하세요'));
  return rpc<{ unconfirmed: number }>('unconfirm_lines', { p_line_ids: lines }, backOf(fd), (d) => `${d.unconfirmed}건 확정취소 (발주수량 차감)`);
}

/* 입고 */
export async function receive(fd: FormData) {
  const lines: { item_id: string; received_qty?: number; storage?: string }[] = [];
  for (const [k, v] of fd.entries()) {
    if (k.startsWith('rq_') && String(v) !== '') lines.push({ item_id: k.slice(3), received_qty: Number(v), storage: String(fd.get('st_' + k.slice(3)) || '') || undefined });
  }
  return rpc<{ po_no: string; shortages: { item: string; ordered: number; received: number }[] }>(
    'receive_po', { p_po_id: str(fd, 'po'), p_lines: lines }, backOf(fd),
    (d) => `${d.po_no} 입고확정` + (d.shortages.length ? ` · 부족 ${d.shortages.map((s) => `${s.item} ${s.received}/${s.ordered}`).join(', ')}` : ''),
  );
}
export async function undoReceive(fd: FormData) {
  return rpc<{ reverted: number }>('undo_receive', { p_po_id: str(fd, 'po') }, backOf(fd), (d) => `입고취소 ${d.reverted}건`);
}

/* 출고·배송 */
export async function ship(fd: FormData) {
  return rpc<{ shipped: number; waiting: number }>('ship_school', { p_school_id: str(fd, 'school'), p_date: str(fd, 'date') }, backOf(fd),
    (d) => `${d.shipped}건 출고확정` + (d.waiting ? ` · 입고대기 ${d.waiting}건 남음` : ''));
}
export async function unship(fd: FormData) {
  const lines = ids(fd);
  if (!lines.length) redirect(withMsg(backOf(fd), 'err', '출고취소할 품목을 선택하세요'));
  return rpc<{ unshipped: number }>('unship_lines', { p_line_ids: lines }, backOf(fd), (d) => `${d.unshipped}건 출고취소`);
}
export async function courseRun(fd: FormData) {
  const a = str(fd, 'action');
  return rpc('course_run', { p_course_id: str(fd, 'course'), p_date: str(fd, 'date'), p_action: a }, backOf(fd),
    a === 'depart' ? '출발 처리했습니다' : a === 'arrive' ? '도착 처리 · 출고 품목 배송완료' : '운행 상태를 초기화했습니다');
}

/* 클레임 */
export async function claimStatus(fd: FormData) {
  const sb = await supabase();
  const { error } = await sb.from('claims').update({ status: str(fd, 'status'), action: str(fd, 'action') || null }).eq('id', str(fd, 'id'));
  if (error) redirect(withMsg(backOf(fd), 'err', error.message));
  revalidatePath('/center/claims');
  redirect(withMsg(backOf(fd), 'msg', '처리상태를 저장했습니다'));
}

/* 기준정보 */
async function insert(table: string, row: Record<string, unknown>, back: string, ok: string) {
  const sb = await supabase();
  const { error } = await sb.from(table).insert(row);
  if (error) redirect(withMsg(back, 'err', error.code === '23505' ? '같은 코드가 이미 있습니다' : error.message));
  revalidatePath('/center/masters');
  redirect(withMsg(back, 'msg', ok));
}
export async function addSchool(fd: FormData) {
  return insert('schools', {
    center_id: str(fd, 'center'), code: str(fd, 'code'), name: str(fd, 'name'), school_level: str(fd, 'level') || null,
    meals: Number(str(fd, 'meals') || 0), neis_code: str(fd, 'neis') || null, course_id: str(fd, 'course') || null,
    delivery_seq: Number(str(fd, 'seq') || 0) || null,
  }, backOf(fd), '학교를 등록했습니다');
}
export async function addSupplier(fd: FormData) {
  return insert('suppliers', {
    center_id: str(fd, 'center'), code: str(fd, 'code'), name: str(fd, 'name'), kind: str(fd, 'kind') || null,
    biz_no: str(fd, 'biz') || null, area: str(fd, 'area') || null, phone: str(fd, 'phone') || null,
  }, backOf(fd), '공급업체를 등록했습니다');
}
export async function addItem(fd: FormData) {
  const sb = await supabase();
  const back = backOf(fd);
  const { data, error } = await sb.from('items').insert({
    center_id: str(fd, 'center'), code: str(fd, 'code'), name: str(fd, 'name'), spec: str(fd, 'spec') || null,
    unit: str(fd, 'unit') || 'kg', tax: str(fd, 'tax') || 'exempt', supplier_id: str(fd, 'supplier') || null,
    category: str(fd, 'category') || null, cert_type: str(fd, 'cert') || null, origin_detail: str(fd, 'origin') || null,
    storage: str(fd, 'storage') || 'chilled',
  }).select('id').single();
  if (error) redirect(withMsg(back, 'err', error.code === '23505' ? '같은 상품코드가 이미 있습니다' : error.message));
  const sale = Number(str(fd, 'sale'));
  if (sale > 0) {
    const { error: e2 } = await sb.from('item_prices').insert({
      item_id: data!.id, sale_price: sale, purchase_price: Number(str(fd, 'purchase') || sale), valid_from: str(fd, 'from'),
    });
    if (e2) redirect(withMsg(back, 'err', '상품은 등록했지만 단가 등록에 실패했습니다: ' + e2.message));
  }
  revalidatePath('/center/masters');
  redirect(withMsg(back, 'msg', '상품을 등록했습니다'));
}
export async function addPrice(fd: FormData) {
  const sb = await supabase();
  const back = backOf(fd);
  const item = str(fd, 'item');
  const from = str(fd, 'from');
  // 이전 단가는 새 적용일 전날로 종료
  const prev = new Date(from + 'T00:00:00Z');
  prev.setUTCDate(prev.getUTCDate() - 1);
  await sb.from('item_prices').update({ valid_to: prev.toISOString().slice(0, 10) }).eq('item_id', item).gte('valid_to', from).lt('valid_from', from);
  const { error } = await sb.from('item_prices').insert({ item_id: item, sale_price: Number(str(fd, 'sale')), purchase_price: Number(str(fd, 'purchase')), valid_from: from });
  if (error) redirect(withMsg(back, 'err', error.message));
  revalidatePath('/center/masters');
  redirect(withMsg(back, 'msg', '새 단가를 등록했습니다'));
}
export async function saveCourse(fd: FormData) {
  const sb = await supabase();
  const back = backOf(fd);
  const row = { name: str(fd, 'name'), vehicle_no: str(fd, 'vehicle') || null, driver_name: str(fd, 'driver') || null, depart_time: str(fd, 'depart') || null };
  const id = str(fd, 'id');
  const { error } = id
    ? await sb.from('courses').update(row).eq('id', id)
    : await sb.from('courses').insert({ ...row, center_id: str(fd, 'center'), code: str(fd, 'code') });
  if (error) redirect(withMsg(back, 'err', error.message));
  revalidatePath('/center/masters');
  redirect(withMsg(back, 'msg', '배송코스를 저장했습니다'));
}
export async function assignCourse(fd: FormData) {
  const sb = await supabase();
  const back = backOf(fd);
  const { error } = await sb.from('schools').update({ course_id: str(fd, 'course') || null, delivery_seq: Number(str(fd, 'seq') || 0) || null, region_id: str(fd, 'region') || null }).eq('id', str(fd, 'school'));
  if (error) redirect(withMsg(back, 'err', error.message));
  revalidatePath('/center', 'layout');
  redirect(withMsg(back, 'msg', '코스 배정을 저장했습니다'));
}

/* 계정 발급 (학교·공급업체) */
export async function createAccount(fd: FormData) {
  const back = backOf(fd);
  const { p, center } = await requireCenter(str(fd, 'center') || undefined);
  const role = str(fd, 'role');
  if (!['school', 'supplier'].includes(role) && !(role === 'center_admin' && p.role === 'province_admin')) {
    redirect(withMsg(back, 'err', '발급할 수 없는 역할입니다'));
  }
  // 소속이 이 센터의 학교/업체인지 확인 (로그인 사용자 권한으로 조회)
  if (role === 'school' || role === 'supplier') {
    const sb = await supabase();
    const { data: org } = await sb.from(role === 'school' ? 'schools' : 'suppliers').select('id').eq('id', str(fd, 'org')).eq('center_id', center.id).maybeSingle();
    if (!org) redirect(withMsg(back, 'err', role === 'school' ? '이 센터의 학교를 선택하세요' : '이 센터의 공급업체를 선택하세요'));
  }
  const admin = adminClient();
  const { data, error } = await admin.auth.admin.createUser({ email: str(fd, 'email'), password: str(fd, 'password'), email_confirm: true });
  if (error || !data.user) redirect(withMsg(back, 'err', '계정 생성 실패: ' + (error?.message ?? '')));
  const { error: e2 } = await admin.from('profiles').insert({
    id: data.user.id, name: str(fd, 'name'), role, center_id: center.id,
    school_id: role === 'school' ? str(fd, 'org') : null, supplier_id: role === 'supplier' ? str(fd, 'org') : null, phone: str(fd, 'phone') || null,
  });
  if (e2) {
    await admin.auth.admin.deleteUser(data.user.id);
    redirect(withMsg(back, 'err', '역할 연결 실패: ' + e2.message));
  }
  revalidatePath('/center/users');
  redirect(withMsg(back, 'msg', `${str(fd, 'email')} 계정을 발급했습니다`));
}

/* umji 연계 */
export async function umjiIngest(fd: FormData) {
  const back = backOf(fd);
  let rows: unknown;
  try {
    rows = JSON.parse(str(fd, 'rows'));
    if (!Array.isArray(rows)) throw new Error('배열이 아닙니다');
  } catch (e) {
    redirect(withMsg(back, 'err', 'JSON 형식 오류: ' + (e as Error).message));
  }
  return rpc<{ loaded: number; mapped: number; errors: number }>('umji_ingest',
    { p_center_id: str(fd, 'center'), p_dataset: str(fd, 'dataset'), p_rows: rows, p_source: 'manual' }, back,
    (d) => `적재 ${d.loaded}건 · 반영 ${d.mapped}건` + (d.errors ? ` · 오류 ${d.errors}건` : ''));
}
