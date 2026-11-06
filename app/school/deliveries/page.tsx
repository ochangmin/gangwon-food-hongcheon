import { requireProfile } from '@/lib/session';
import { type SP, sumBy } from '@/lib/page';
import { won, qty, dlabel, addDays, today } from '@/lib/format';
import { Flash, PageHead, Back, Empty, Pill } from '@/components/ui';
import { confirmReceipt, newClaim } from '../actions';

type Sh = { id: string; statement_no: string; delivery_date: string; delivered_at: string | null; received_by: string | null };
type L = { id: string; shipment_id: string; item_id: string; item_name: string; spec: string; unit: string; qty: number; sale_price: number; amount: number; vat: number; lot_no: string | null; origin: string; origin_detail: string | null; cert_type: string | null; status: string };
const TYPES = ['품질불량', '수량부족', '이물질', '오배송', '배송지연', '온도이탈', '기타'];

export default async function Deliveries({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { sb, p } = await requireProfile(['school']);
  const from = addDays(today(), -21);
  const { data: shData } = await sb.from('shipments').select('id,statement_no,delivery_date,delivered_at,received_by').eq('school_id', p.school_id!).gte('delivery_date', from).order('delivery_date', { ascending: false });
  const ships = (shData ?? []) as Sh[];
  const { data: lData } = ships.length
    ? await sb.from('v_order_lines').select('id,shipment_id,item_id,item_name,spec,unit,qty,sale_price,amount,vat,lot_no,origin,origin_detail,cert_type,status').in('shipment_id', ships.map((s) => s.id)).order('item_name')
    : { data: [] };
  const lines = (lData ?? []) as L[];
  const back = '/school/deliveries';

  return (
    <>
      <PageHead crumb={p.schools?.name ?? '학교'} title="납품·검수" desc="최근 3주 납품 거래명세서입니다. 검수 후 검수자를 기록하고, 문제가 있으면 품목별로 클레임을 접수하세요." />
      <Flash msg={sp.msg} err={sp.err} />
      {!ships.length ? <section className="panel"><Empty>최근 3주 납품 내역이 없습니다.</Empty></section> : ships.map((s) => {
        const ls = lines.filter((l) => l.shipment_id === s.id);
        return (
          <section className="panel" key={s.id}>
            <header>
              <h2>{dlabel(s.delivery_date)} <span className="mono dim">{s.statement_no}</span></h2>
              {s.received_by ? <span className="pill s-delivered">검수 {s.received_by}</span> : (
                <form action={confirmReceipt} className="bar" style={{ margin: 0 }}>
                  <Back value={back} /><input type="hidden" name="shipment" value={s.id} />
                  <input type="text" name="by" required placeholder="검수자 이름" aria-label="검수자" />
                  <button className="btn pri">검수 확인</button>
                </form>
              )}
            </header>
            <div className="tw"><table>
              <thead><tr><th>상태</th><th>품명</th><th>규격</th><th className="n">수량</th><th className="n">단가</th><th className="n">금액</th><th className="n">세액</th><th>원산지</th><th>인증</th><th>로트</th></tr></thead>
              <tbody>{ls.map((l) => (
                <tr key={l.id}><td><Pill s={l.status} /></td><td>{l.item_name}</td><td>{l.spec}</td><td className="n">{qty(l.qty)} {l.unit}</td><td className="n">{won(l.sale_price)}</td>
                  <td className="n">{won(l.amount)}</td><td className="n">{won(l.vat)}</td><td>{l.origin} {l.origin_detail}</td><td>{l.cert_type}</td><td className="mono">{l.lot_no}</td></tr>))}</tbody>
              <tfoot><tr><td colSpan={5}>합계 {won(sumBy(ls, (l) => Number(l.amount) + Number(l.vat)))}원</td><td className="n">{won(sumBy(ls, (l) => Number(l.amount)))}</td><td className="n">{won(sumBy(ls, (l) => Number(l.vat)))}</td><td colSpan={3} /></tr></tfoot>
            </table></div>
            <details>
              <summary className="pad" style={{ paddingBlock: 10, borderTop: '1px solid var(--line)' }}>이 납품 건으로 클레임 접수</summary>
              <form action={newClaim} className="pad form">
                <Back value={back} /><input type="hidden" name="school" value={p.school_id!} /><input type="hidden" name="date" value={s.delivery_date} />
                <label>품목<select name="item">{ls.map((l) => <option key={l.id} value={l.item_id}>{l.item_name}</option>)}</select></label>
                <label>유형<select name="type">{TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
                <label>수량<input type="number" name="qty" min="0" step="0.1" defaultValue="1" /></label>
                <label>요청 조치<select name="action"><option value="">센터 판단</option><option>교환</option><option>반품</option><option>감액</option><option>추가배송</option></select></label>
                <label className="wide">내용<input type="text" name="desc" required placeholder="검수 시 확인된 내용을 적어주세요" /></label>
                <div><button className="btn pri">접수</button></div>
              </form>
            </details>
          </section>
        );
      })}
    </>
  );
}
