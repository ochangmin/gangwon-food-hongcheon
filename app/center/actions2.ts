'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { supabase } from '@/lib/supabase/server';
import { rpc, backOf, str, withMsg } from '@/lib/act';

/* 주문변경 승인·반려 */
export async function approveChange(fd: FormData) {
  return processChange(fd, true);
}
export async function rejectChange(fd: FormData) {
  return processChange(fd, false);
}
async function processChange(fd: FormData, approve: boolean) {
  return rpc('process_order_change', { p_id: str(fd, 'id'), p_approve: approve, p_reply: str(fd, 'reply') || null }, backOf(fd), approve ? '변경을 승인해 주문·발주 수량에 반영했습니다' : '변경 요청을 반려했습니다');
}

/* 보조금 정산 */
export async function settleSubsidies(fd: FormData) {
  return rpc<{ rows: number }>('settle_subsidies', { p_center_id: str(fd, 'center'), p_month: str(fd, 'month') }, backOf(fd), (d) => `${d.rows}건 정산 계산을 갱신했습니다`);
}
export async function saveSettlement(fd: FormData) {
  const sb = await supabase();
  const done = str(fd, 'status') === '정산완료';
  const { error } = await sb.from('subsidy_settlements').update({
    settled_amount: Number(str(fd, 'amount') || 0), status: done ? '정산완료' : '미정산', settled_at: done ? new Date().toISOString() : null, note: str(fd, 'note') || null,
  }).eq('id', str(fd, 'id'));
  if (error) redirect(withMsg(backOf(fd), 'err', error.message));
  revalidatePath('/center/subsidy-settle');
  redirect(withMsg(backOf(fd), 'msg', '정산 내용을 저장했습니다'));
}

/* 센터 간 거래 */
export async function requestTrade(fd: FormData) {
  return rpc('request_trade', { p_center_id: str(fd, 'center'), p_shared_id: str(fd, 'shared'), p_date: str(fd, 'date'), p_qty: Number(str(fd, 'qty') || 0), p_note: str(fd, 'note') || null }, backOf(fd), '거래를 요청했습니다');
}
export async function tradeStep(fd: FormData) {
  return rpc('trade_step', { p_id: str(fd, 'id'), p_status: str(fd, 'status') }, backOf(fd), `${str(fd, 'status')} 처리했습니다`);
}

/* 센터정보 */
export async function saveCenterInfo(fd: FormData) {
  const sb = await supabase();
  const { error } = await sb.from('centers').update({
    name: str(fd, 'name'), ceo_name: str(fd, 'ceo') || null, address: str(fd, 'address') || null, tel: str(fd, 'tel') || null,
    fax: str(fd, 'fax') || null, biz_no: str(fd, 'biz') || null, business_type: str(fd, 'btype') || null, note: str(fd, 'note') || null,
  }).eq('id', str(fd, 'center'));
  if (error) redirect(withMsg(backOf(fd), 'err', error.message));
  revalidatePath('/', 'layout');
  redirect(withMsg(backOf(fd), 'msg', '센터정보를 저장했습니다'));
}
