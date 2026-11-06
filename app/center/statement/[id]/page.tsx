import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCenter } from '@/lib/session';
import { type SP, sumBy } from '@/lib/page';
import { won, qty, dlabel } from '@/lib/format';
import { Flash, Pill, Back } from '@/components/ui';
import { PrintButton } from '@/components/PrintButton';
import { unship } from '../../actions';

type L = { id: string; item_name: string; spec: string; unit: string; qty: number; sale_price: number; amount: number; vat: number;
  tax: string; origin: string; origin_detail: string; cert_type: string; lot_no: string; status: string };

export default async function Statement({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params;
  const sp = await searchParams;
  const { sb, center } = await requireCenter(sp.center);
  const { data: sh } = await sb.from('shipments').select('id,statement_no,delivery_date,delivered_at,received_by,schools(name,code,address)').eq('id', id).single();
  if (!sh) notFound();
  const { data } = await sb.from('v_order_lines')
    .select('id,item_name,spec,unit,qty,sale_price,amount,vat,tax,origin,origin_detail,cert_type,lot_no,status').eq('shipment_id', id).order('item_name');
  const lines = (data ?? []) as L[];
  const { data: seal } = await sb.from('seals').select('image_data').eq('center_id', center.id).eq('is_default', true).limit(1).maybeSingle();
  const school = sh.schools as unknown as { name: string; code: string; address: string | null };
  const back = `/center/statement/${id}${sp.center ? `?center=${sp.center}` : ''}`;
  const amt = sumBy(lines, (l) => Number(l.amount)), vat = sumBy(lines, (l) => Number(l.vat));

  return (
    <>
      <div className="bar noprint">
        <Link className="btn" href={`/center/shipping?date=${sh.delivery_date}${sp.center ? `&center=${sp.center}` : ''}`}>‹ 출고 목록</Link>
        <span className="sp" />
        <PrintButton />
      </div>
      <Flash msg={sp.msg} err={sp.err} />
      <form className="panel pad stmt">
        <Back value={back} />
        <h2 className="t">거래명세서</h2>
        <p className="dim" style={{ textAlign: 'center', margin: 0 }}>{sh.statement_no} · 공급받는자 보관용</p>
        <div className="parties">
          <div><b>공급자</b>{center.name}<br /><span className="dim">강원특별자치도 {center.sigungu}</span>
            {seal?.image_data ? <img src={seal.image_data} alt="센터 인장" style={{ height: 48, float: 'right', marginTop: -24 }} /> : null}</div>
          <div><b>공급받는자</b>{school.name} <span className="mono dim">{school.code}</span><br /><span className="dim">납품일 {dlabel(sh.delivery_date)}{sh.received_by ? ` · 검수 ${sh.received_by}` : ''}</span></div>
        </div>
        <div className="tw"><table>
          <thead><tr><th className="noprint" /><th>품명</th><th>규격</th><th>단위</th><th className="n">수량</th><th className="n">단가</th><th className="n">공급가액</th><th className="n">세액</th><th>원산지</th><th>인증</th><th>로트번호</th></tr></thead>
          <tbody>{lines.map((l) => (
            <tr key={l.id}>
              <td className="noprint">{l.status === 'shipped' ? <input type="checkbox" name="line" value={l.id} aria-label="출고취소 선택" /> : <Pill s={l.status} />}</td>
              <td>{l.item_name}</td><td>{l.spec}</td><td>{l.unit}</td><td className="n">{qty(l.qty)}</td><td className="n">{won(l.sale_price)}</td>
              <td className="n">{won(l.amount)}</td><td className="n">{won(l.vat)}</td><td>{l.origin} {l.origin_detail}</td><td>{l.cert_type}</td><td className="mono">{l.lot_no}</td>
            </tr>))}</tbody>
          <tfoot><tr><td className="noprint" /><td colSpan={5}>합계 {won(amt + vat)}원</td><td className="n">{won(amt)}</td><td className="n">{won(vat)}</td><td colSpan={3} /></tr></tfoot>
        </table></div>
        <div className="bar noprint" style={{ marginTop: 12 }}>
          <button className="btn dan" formAction={unship}>선택 품목 출고취소</button>
        </div>
      </form>
    </>
  );
}
