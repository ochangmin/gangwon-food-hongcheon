'use server';
import { rpc, backOf, str } from '@/lib/act';

export async function ackPo(fd: FormData) {
  const lines: { item_id: string; ack_qty: number }[] = [];
  for (const [k, v] of fd.entries()) if (k.startsWith('aq_') && String(v) !== '') lines.push({ item_id: k.slice(3), ack_qty: Number(v) });
  return rpc('ack_po', { p_po_id: str(fd, 'po'), p_lines: lines }, backOf(fd), '발주 수량을 회신했습니다');
}

export async function addCert(fd: FormData) {
  const { requireProfile } = await import('@/lib/session');
  const { redirect } = await import('next/navigation');
  const { withMsg } = await import('@/lib/act');
  const { sb, p } = await requireProfile(['supplier']);
  const { error } = await sb.from('certifications').insert({
    center_id: p.center_id, supplier_id: p.supplier_id, cert_type: str(fd, 'type'), cert_no: str(fd, 'no'), issuer: str(fd, 'issuer') || null,
    valid_from: str(fd, 'from'), valid_to: str(fd, 'to'), note: str(fd, 'note') || null,
  });
  if (error) redirect(withMsg(backOf(fd), 'err', error.message));
  redirect(withMsg(backOf(fd), 'msg', '인증정보를 등록했습니다'));
}
