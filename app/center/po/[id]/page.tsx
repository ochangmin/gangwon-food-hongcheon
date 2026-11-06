import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCenter } from '@/lib/session';
import { type SP, sumBy } from '@/lib/page';
import { won, qty, dlabel, PO_STATUS } from '@/lib/format';
import { PrintButton } from '@/components/PrintButton';

type Po = { id: string; po_no: string; delivery_date: string; status: string; suppliers: { name: string; code: string; phone: string | null };
  po_lines: { id: string; qty: number; ack_qty: number | null; received_qty: number | null; purchase_price: number; items: { name: string; spec: string | null; unit: string; storage: string } }[] };

export default async function PoPrint({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params;
  const sp = await searchParams;
  const { sb, center } = await requireCenter(sp.center);
  const { data } = await sb.from('purchase_orders').select('id,po_no,delivery_date,status,suppliers(name,code,phone),po_lines(id,qty,ack_qty,received_qty,purchase_price,items(name,spec,unit,storage))').eq('id', id).single();
  if (!data) notFound();
  const po = data as unknown as Po;
  const { data: seal } = await sb.from('seals').select('image_data').eq('center_id', center.id).eq('is_default', true).limit(1).maybeSingle();
  const total = sumBy(po.po_lines, (l) => Number(l.qty) * Number(l.purchase_price));
  return (
    <>
      <div className="bar noprint">
        <Link className="btn" href={`/center/prints?date=${po.delivery_date}${sp.center ? `&center=${sp.center}` : ''}`}>‹ 출력물모음</Link>
        <span className="sp" /><PrintButton />
      </div>
      <section className="panel pad stmt">
        <h2 className="t">발 주 서</h2>
        <p className="dim" style={{ textAlign: 'center', margin: 0 }}>{po.po_no} · {PO_STATUS[po.status]}</p>
        <div className="parties">
          <div><b>발주처</b>{center.name}<br /><span className="dim">강원특별자치도 {center.sigungu}</span>
            {seal?.image_data ? <img src={seal.image_data} alt="센터 인장" style={{ height: 48, float: 'right', marginTop: -24 }} /> : null}</div>
          <div><b>공급업체</b>{po.suppliers.name} <span className="mono dim">{po.suppliers.code}</span><br /><span className="dim">납품일 {dlabel(po.delivery_date)} {po.suppliers.phone ?? ''}</span></div>
        </div>
        <div className="tw"><table>
          <thead><tr><th className="n">No</th><th>품명</th><th>규격</th><th>단위</th><th className="n">발주수량</th><th className="n">단가</th><th className="n">금액</th><th>보관</th></tr></thead>
          <tbody>{po.po_lines.map((l, i) => (
            <tr key={l.id}><td className="n">{i + 1}</td><td>{l.items.name}</td><td>{l.items.spec}</td><td>{l.items.unit}</td><td className="n">{qty(l.qty)}</td>
              <td className="n">{won(l.purchase_price)}</td><td className="n">{won(Number(l.qty) * Number(l.purchase_price))}</td><td>{({ ambient: '상온', chilled: '냉장', frozen: '냉동' } as Record<string, string>)[l.items.storage]}</td></tr>))}</tbody>
          <tfoot><tr><td colSpan={6}>합계</td><td className="n">{won(total)}</td><td /></tr></tfoot>
        </table></div>
      </section>
    </>
  );
}
