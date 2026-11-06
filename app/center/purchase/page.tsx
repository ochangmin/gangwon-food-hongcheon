import { requireCenter } from '@/lib/session';
import { ctx, type SP } from '@/lib/page';
import { won, qty, STORAGE, addDays, today } from '@/lib/format';
import { DateBar, Flash, PageHead, Pill, Back, Empty } from '@/components/ui';
import { receive, undoReceive } from '../actions';

type PoLine = { id: string; item_id: string; qty: number; ack_qty: number | null; received_qty: number | null; purchase_price: number;
  items: { code: string; name: string; spec: string; unit: string; storage: string; cert_type: string } };
type Po = { id: string; po_no: string; status: string; acknowledged_at: string | null; suppliers: { name: string; code: string }; po_lines: PoLine[] };

export default async function Purchase({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { sb, center } = await requireCenter(sp.center);
  const c = ctx('/center/purchase', sp, addDays(today(), 1));
  const [{ data }, { data: lots }] = await Promise.all([
    sb.from('purchase_orders')
      .select('id,po_no,status,acknowledged_at,suppliers(name,code),po_lines(id,item_id,qty,ack_qty,received_qty,purchase_price,items(code,name,spec,unit,storage,cert_type))')
      .eq('center_id', center.id).eq('delivery_date', c.date).order('po_no'),
    sb.from('lots').select('po_line_id,lot_no').eq('center_id', center.id).eq('received_date', c.date),
  ]);
  const pos = (data ?? []) as unknown as Po[];
  const lotOf = (pl: string) => lots?.find((l) => l.po_line_id === pl)?.lot_no;

  return (
    <>
      <PageHead crumb="주문·발주" title="발주·입고" umji="PU010400"
        desc="공급업체별 발주와 업체 회신 수량을 확인하고, 실제 입고 수량과 보관 창고를 기록합니다. 입고확정 시 로트번호가 부여됩니다." />
      <DateBar path="/center/purchase" date={c.date} keep={c.keep} />
      <Flash msg={c.msg} err={c.err} />
      {!pos.length ? <section className="panel"><Empty>이 납품일의 발주가 없습니다. 주문확정을 먼저 진행하세요.</Empty></section> : pos.map((po) => {
        const done = po.status === 'received';
        return (
          <form className="panel" key={po.id}>
            <Back value={c.back} /><input type="hidden" name="po" value={po.id} />
            <header>
              <h2>{po.suppliers.name} <span className="mono dim">{po.po_no}</span></h2>
              <div className="bar" style={{ margin: 0 }}>
                <Pill s={po.status} kind="po" />
                {po.acknowledged_at ? <small>업체확인 {new Date(po.acknowledged_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</small> : <small>업체 미확인</small>}
                {!done ? <button className="btn pri" formAction={receive}>입고확정</button> : null}
                <button className="btn dan" formAction={undoReceive}>입고취소</button>
              </div>
            </header>
            <div className="tw"><table>
              <thead><tr><th>상품</th><th>규격</th><th>인증</th><th className="n">발주</th><th className="n">업체회신</th><th>입고수량</th><th>창고</th><th>로트번호</th><th className="n">매입금액</th></tr></thead>
              <tbody>{po.po_lines.map((l) => {
                const lot = lotOf(l.id);
                const pending = Number(l.qty) - Number(l.received_qty ?? 0);
                return (
                  <tr key={l.id}>
                    <td>{l.items.name}</td><td className="dim">{l.items.spec}</td><td>{l.items.cert_type}</td>
                    <td className="n">{qty(l.qty)} {l.items.unit}</td>
                    <td className="n">{l.ack_qty == null ? '—' : qty(l.ack_qty)}</td>
                    <td>{pending > 0 && !done
                      ? <input className="q" type="number" step="0.01" min="0" name={`rq_${l.item_id}`} defaultValue={l.ack_qty ?? pending} aria-label={l.items.name + ' 입고수량'} />
                      : <span className="n">{qty(l.received_qty)}</span>}</td>
                    <td>{pending > 0 && !done
                      ? <select name={`st_${l.item_id}`} defaultValue={l.items.storage} aria-label="창고">{Object.entries(STORAGE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                      : STORAGE[l.items.storage]}</td>
                    <td className="mono">{lot ?? '—'}</td>
                    <td className="n">{won(Number(l.qty) * Number(l.purchase_price))}</td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          </form>
        );
      })}
    </>
  );
}
