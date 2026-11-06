'use server';
import { rpc, backOf, str } from '@/lib/act';

export async function ackPo(fd: FormData) {
  const lines: { item_id: string; ack_qty: number }[] = [];
  for (const [k, v] of fd.entries()) if (k.startsWith('aq_') && String(v) !== '') lines.push({ item_id: k.slice(3), ack_qty: Number(v) });
  return rpc('ack_po', { p_po_id: str(fd, 'po'), p_lines: lines }, backOf(fd), '발주 수량을 회신했습니다');
}
