import { requireCenter } from '@/lib/session';
import { ctx, type SP, groupBy, sumBy } from '@/lib/page';
import { won, qty, addDays, today } from '@/lib/format';
import { DateBar, Flash, PageHead, Pill, Back, Empty } from '@/components/ui';
import { confirmAll, confirmSchools, unconfirm } from '../actions';

type Line = { id: string; school_id: string; school_code: string; school_name: string; item_name: string; spec: string; unit: string;
  supplier_name: string; qty: number; sale_price: number; amount: number; vat: number; status: string; tax: string };

export default async function Orders({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { sb, center } = await requireCenter(sp.center);
  const c = ctx('/center/orders', sp, addDays(today(), 1));
  const { data } = await sb.from('v_order_lines')
    .select('id,school_id,school_code,school_name,item_name,spec,unit,supplier_name,qty,sale_price,amount,vat,status,tax')
    .eq('center_id', center.id).eq('delivery_date', c.date).in('status', ['draft', 'submitted', 'confirmed'])
    .order('school_code').order('item_name');
  const lines = (data ?? []) as Line[];
  const bySchool = groupBy(lines, (l) => l.school_id);
  const waiting = lines.filter((l) => l.status === 'submitted').length;

  return (
    <>
      <PageHead crumb="주문·발주" title="주문확정" umji="SA020120"
        desc="학교가 제출한 주문을 확정하면 공급업체별 발주가 자동으로 만들어집니다. 입고 전까지는 확정취소할 수 있습니다." />
      <DateBar path="/center/orders" date={c.date} keep={c.keep} />
      <Flash msg={c.msg} err={c.err} />
      {!lines.length ? <section className="panel"><Empty>이 납품일에 제출된 주문이 없습니다.</Empty></section> : (
        <form>
          <Back value={c.back} />
          <input type="hidden" name="center" value={center.id} />
          <input type="hidden" name="date" value={c.date} />
          <div className="bar">
            <button className="btn pri" formAction={confirmAll} disabled={!waiting}>전체 학교 확정 ({waiting}건)</button>
            <button className="btn" formAction={confirmSchools}>선택 학교 확정</button>
            <button className="btn dan" formAction={unconfirm}>선택 품목 확정취소</button>
          </div>
          <section className="panel">
            <header><h2>학교별 주문</h2><small>작성중 품목은 학교가 제출해야 확정할 수 있습니다</small></header>
            <div className="tw"><table>
              <thead><tr><th>선택</th><th>학교</th><th className="n">작성중</th><th className="n">제출</th><th className="n">확정</th><th className="n">주문 금액</th></tr></thead>
              <tbody>{[...bySchool.entries()].map(([sid, ls]) => (
                <tr key={sid}>
                  <td><input type="checkbox" name="school" value={sid} aria-label={ls[0].school_name + ' 선택'} /></td>
                  <td>{ls[0].school_name} <span className="mono dim">{ls[0].school_code}</span></td>
                  <td className="n">{ls.filter((l) => l.status === 'draft').length}</td>
                  <td className="n">{ls.filter((l) => l.status === 'submitted').length}</td>
                  <td className="n">{ls.filter((l) => l.status === 'confirmed').length}</td>
                  <td className="n">{won(sumBy(ls, (l) => Number(l.amount) + Number(l.vat)))}</td>
                </tr>))}</tbody>
            </table></div>
          </section>
          <section className="panel">
            <header><h2>품목 상세</h2><small>{lines.length}건</small></header>
            <div className="tw"><table>
              <thead><tr><th>선택</th><th>상태</th><th>학교</th><th>상품</th><th>규격</th><th>공급업체</th><th className="n">수량</th><th className="n">단가</th><th className="n">금액</th><th className="n">부가세</th></tr></thead>
              <tbody>{lines.map((l) => (
                <tr key={l.id}>
                  <td><input type="checkbox" name="line" value={l.id} disabled={l.status !== 'confirmed'} aria-label="선택" /></td>
                  <td><Pill s={l.status} /></td><td>{l.school_name}</td><td>{l.item_name}</td><td className="dim">{l.spec}</td><td>{l.supplier_name}</td>
                  <td className="n">{qty(l.qty)} {l.unit}</td><td className="n">{won(l.sale_price)}</td><td className="n">{won(l.amount)}</td><td className="n">{won(l.vat)}</td>
                </tr>))}</tbody>
              <tfoot><tr><td colSpan={8}>합계</td><td className="n">{won(sumBy(lines, (l) => Number(l.amount)))}</td><td className="n">{won(sumBy(lines, (l) => Number(l.vat)))}</td></tr></tfoot>
            </table></div>
          </section>
        </form>
      )}
    </>
  );
}
