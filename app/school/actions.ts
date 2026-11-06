'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { supabase } from '@/lib/supabase/server';
import { backOf, str, rpc, withMsg } from '@/lib/act';
import { today } from '@/lib/format';

/** 주간 주문 저장/제출: 입력칸 이름 q_<납품일>_<상품ID> */
export async function draftWeek(fd: FormData) {
  return saveWeek(fd, false);
}
export async function submitWeek(fd: FormData) {
  return saveWeek(fd, true);
}
async function saveWeek(fd: FormData, submit: boolean) {
  const back = backOf(fd);
  const school = str(fd, 'school');
  const days = fd.getAll('day').map(String);
  const sb = await supabase();
  const t = today();
  let saved = 0, locked = 0;
  const errors: string[] = [];
  for (const d of days) {
    if (d <= t) continue;
    const lines: { item_id: string; qty: number }[] = [];
    for (const [k, v] of fd.entries()) {
      if (!k.startsWith(`q_${d}_`)) continue;
      lines.push({ item_id: k.slice(`q_${d}_`.length), qty: Number(v || 0) });
    }
    const hasExisting = str(fd, `has_${d}`) === '1';
    if (!hasExisting && !lines.some((l) => l.qty > 0)) continue;
    const { data, error } = await sb.rpc('save_order', { p_school_id: school, p_date: d, p_lines: lines.filter((l) => l.qty > 0 || hasExisting), p_submit: submit });
    if (error) errors.push(`${d}: ${error.message}`);
    else { saved += data.saved; locked += data.locked; }
  }
  revalidatePath('/', 'layout');
  if (errors.length) redirect(withMsg(back, 'err', errors.join(' / ')));
  redirect(withMsg(back, 'msg', (submit ? '주문을 제출했습니다' : '임시저장했습니다') + ` · ${saved}건` + (locked ? ` · 확정된 ${locked}건은 변경되지 않음` : '')));
}

export async function confirmReceipt(fd: FormData) {
  return rpc('confirm_receipt', { p_shipment_id: str(fd, 'shipment'), p_received_by: str(fd, 'by') }, backOf(fd), '검수 확인을 기록했습니다');
}

export async function newClaim(fd: FormData) {
  return rpc<{ claim_no: string; lot_id: string | null }>('create_claim', {
    p_school_id: str(fd, 'school'), p_item_id: str(fd, 'item'), p_date: str(fd, 'date') || today(),
    p_type: str(fd, 'type'), p_qty: Number(str(fd, 'qty') || 0), p_description: str(fd, 'desc'), p_action: str(fd, 'action') || null,
  }, backOf(fd), (d) => `클레임 ${d.claim_no} 접수` + (d.lot_id ? ' · 로트 연결' : ''));
}

export async function requestChange(fd: FormData) {
  return rpc('request_order_change', { p_line_id: str(fd, 'line'), p_qty: Number(str(fd, 'qty') || 0), p_reason: str(fd, 'reason') }, backOf(fd), '변경 요청을 보냈습니다. 센터가 승인하면 반영됩니다');
}
