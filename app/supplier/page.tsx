import { requireProfile } from '@/lib/session';
import { type SP, sumBy } from '@/lib/page';
import { won, qty, dlabel, addDays, today } from '@/lib/format';
import { Flash, PageHead, Back, Empty, Pill } from '@/components/ui';
import { ackPo } from './actions';

type Po = { id: string; po_no: string; delivery_date: string; status: string; acknowledged_at: string | null;
  po_lines: { id: string; item_id: string; qty: number; ack_qty: number | null; received_qty: number | null; purchase_price: number; items: { name: string; spec: string | null; unit: string } }[] };

export default async function SupplierHome({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { sb, p } = await requireProfile(['supplier']);
  const { data } = await sb.from('purchase_orders')
    .select('id,po_no,delivery_date,status,acknowledged_at,po_lines(id,item_id,qty,ack_qty,received_qty,purchase_price,items(name,spec,unit))')
    .gte('delivery_date', addDays(today(), -3)).neq('status', 'canceled').order('delivery_date');
  const pos = (data ?? []) as unknown as Po[];

  return (
    <>
      <PageHead crumb={p.suppliers?.name ?? '공급업체'} title="발주 확인"
        desc="센터 발주를 확인하고 납품 가능한 수량을 회신하세요. 수량이 모자라면 회신 수량을 줄여 입력하면 센터가 미리 대응할 수 있습니다." />
      <Flash msg={sp.msg} err={sp.err} />
      {!pos.length ? <section className="panel"><Empty>받은 발주가 없습니다.</Empty></section> : pos.map((po) => {
        const open = po.status === 'issued' || po.status === 'acknowledged';
        return (
          <form className="panel" key={po.id} action={ackPo}>
            <Back value="/supplier" /><input type="hidden" name="po" value={po.id} />
            <header>
              <h2>{dlabel(po.delivery_date)} 납품 <span className="mono dim">{po.po_no}</span></h2>
              <div className="bar" style={{ margin: 0 }}>
                <Pill s={po.status} kind="po" />
                {open ? <button className="btn pri">{po.status === 'acknowledged' ? '회신 수정' : '수량 회신'}</button> : null}
              </div>
            </header>
            <div className="tw"><table>
              <thead><tr><th>품목</th><th>규격</th><th className="n">발주수량</th><th>납품 가능 수량</th><th className="n">입고수량</th><th className="n">단가</th><th className="n">금액</th></tr></thead>
              <tbody>{po.po_lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.items.name}</td><td className="dim">{l.items.spec}</td><td className="n">{qty(l.qty)} {l.items.unit}</td>
                  <td>{open ? <input className="q" type="number" min="0" step="0.01" name={`aq_${l.item_id}`} defaultValue={l.ack_qty ?? l.qty} aria-label={l.items.name + ' 납품 가능 수량'} /> : qty(l.ack_qty)}</td>
                  <td className="n">{l.received_qty == null ? '—' : qty(l.received_qty)}</td>
                  <td className="n">{won(l.purchase_price)}</td><td className="n">{won(Number(l.qty) * Number(l.purchase_price))}</td>
                </tr>))}</tbody>
              <tfoot><tr><td colSpan={6}>합계</td><td className="n">{won(sumBy(po.po_lines, (l) => Number(l.qty) * Number(l.purchase_price)))}</td></tr></tfoot>
            </table></div>
          </form>
        );
      })}
    </>
  );
}
