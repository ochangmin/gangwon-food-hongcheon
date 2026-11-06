import Link from 'next/link';
import { requireCenter } from '@/lib/session';
import { ctx, type SP, groupBy, sumBy } from '@/lib/page';
import { won, addDays, today } from '@/lib/format';
import { DateBar, Flash, PageHead, Back, Empty } from '@/components/ui';
import { ship } from '../actions';

type L = { school_id: string; school_code: string; school_name: string; status: string; amount: number; vat: number; shipment_id: string | null };

export default async function Shipping({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { sb, center } = await requireCenter(sp.center);
  const c = ctx('/center/shipping', sp, addDays(today(), 1));
  const { data } = await sb.from('v_order_lines').select('school_id,school_code,school_name,status,amount,vat,shipment_id')
    .eq('center_id', center.id).eq('delivery_date', c.date).in('status', ['confirmed', 'received', 'shipped', 'delivered']).order('school_code');
  const lines = (data ?? []) as L[];
  const { data: ships } = await sb.from('shipments').select('id,school_id,statement_no,delivered_at,received_by').eq('center_id', center.id).eq('delivery_date', c.date);
  const groups = [...groupBy(lines, (l) => l.school_id).entries()];
  const cnt = (ls: L[], s: string) => ls.filter((l) => l.status === s).length;

  return (
    <>
      <PageHead crumb="출고·배송" title="출고·거래명세" umji="SA020240"
        desc="입고된 품목을 학교별로 출고확정하고 거래명세서를 발행합니다. 입고되지 않은 품목은 남겨 두었다가 입고 후 추가 출고할 수 있습니다." />
      <DateBar path="/center/shipping" date={c.date} keep={c.keep} />
      <Flash msg={c.msg} err={c.err} />
      <section className="panel">
        {!groups.length ? <Empty>이 납품일에 확정된 주문이 없습니다.</Empty> : (
          <div className="tw"><table>
            <thead><tr><th>학교</th><th className="n">입고대기</th><th className="n">출고대기</th><th className="n">출고</th><th className="n">배송완료</th><th className="n">금액(VAT 포함)</th><th>거래명세서</th><th>검수</th><th /></tr></thead>
            <tbody>{groups.map(([sid, ls]) => {
              const sh = ships?.find((x) => x.school_id === sid);
              const ready = cnt(ls, 'received');
              return (
                <tr key={sid}>
                  <td>{ls[0].school_name} <span className="mono dim">{ls[0].school_code}</span></td>
                  <td className="n">{cnt(ls, 'confirmed') || ''}</td>
                  <td className="n">{ready || ''}</td>
                  <td className="n">{cnt(ls, 'shipped') || ''}</td>
                  <td className="n">{cnt(ls, 'delivered') || ''}</td>
                  <td className="n">{won(sumBy(ls, (l) => Number(l.amount) + Number(l.vat)))}</td>
                  <td>{sh ? <Link className="mono" href={`/center/statement/${sh.id}${sp.center ? `?center=${sp.center}` : ''}`}>{sh.statement_no}</Link> : <span className="dim">—</span>}</td>
                  <td>{sh?.received_by ? <span className="pill s-delivered">{sh.received_by}</span> : <span className="dim">—</span>}</td>
                  <td>{ready ? (
                    <form action={ship}>
                      <Back value={c.back} /><input type="hidden" name="school" value={sid} /><input type="hidden" name="date" value={c.date} />
                      <button className="btn pri">출고확정 {ready}건</button>
                    </form>) : null}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
