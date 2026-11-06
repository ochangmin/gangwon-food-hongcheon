import type { SupabaseClient } from '@supabase/supabase-js';
import { won, qty, dlabel, today, STATUS } from '@/lib/format';
import { sumBy } from '@/lib/page';
import { Back, Empty } from './ui';
import { ExportCsv } from './ExportCsv';
import { draftWeek, submitWeek } from '@/app/school/actions';

type Item = { id: string; code: string; name: string; spec: string | null; unit: string; category: string | null; cert_type: string | null;
  item_prices: { sale_price: number; valid_from: string; valid_to: string }[] };
type L = { item_id: string; delivery_date: string; qty: number; status: string; amount: number };

/** 발주등록 그리드 (주간·월간 공용): 행=상품, 열=납품일 */
export async function OrderGrid({ sb, schoolId, schoolName, days, back, addPath, adds }: {
  sb: SupabaseClient; schoolId: string; schoolName: string; days: string[]; back: string; addPath: string; adds: string[];
}) {
  const t = today();
  const [{ data: itemsData }, { data: linesData }, { data: susp }] = await Promise.all([
    sb.from('items').select('id,code,name,spec,unit,category,cert_type,item_prices(sale_price,valid_from,valid_to)').eq('active', true).order('category').order('name'),
    sb.from('v_order_lines').select('item_id,delivery_date,qty,status,amount').eq('school_id', schoolId).gte('delivery_date', days[0]).lte('delivery_date', days[days.length - 1]),
    sb.from('item_suspensions').select('item_id,from_date,to_date,reason').gte('to_date', days[0]).lte('from_date', days[days.length - 1]),
  ]);
  const items = (itemsData ?? []) as unknown as Item[];
  const lines = (linesData ?? []) as L[];
  const shown = items.filter((i) => lines.some((l) => l.item_id === i.id) || adds.includes(i.id));
  const rest = items.filter((i) => !shown.includes(i));
  const priceOf = (i: Item) => i.item_prices.find((x) => x.valid_from <= days[0] && x.valid_to >= days[0])?.sale_price;
  const suspended = (itemId: string, d: string) => (susp ?? []).find((s) => s.item_id === itemId && s.from_date <= d && s.to_date >= d);
  const dayState = (d: string) => {
    const ls = lines.filter((l) => l.delivery_date === d);
    if (!ls.length) return '';
    const st = ['draft', 'submitted', 'confirmed', 'received', 'shipped', 'delivered'].find((s) => ls.some((l) => l.status === s))!;
    return STATUS[st];
  };
  const [addBase, addQuery] = addPath.split('?');
  const keep = new URLSearchParams(addQuery ?? '');

  return (
    <>
      <form className="bar" action={addBase}>
        {[...keep.entries()].filter(([k]) => k !== 'add').map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <select name="add" aria-label="품목 추가" defaultValue="">
          <option value="" disabled>품목 추가…</option>
          {rest.map((i) => <option key={i.id} value={[...adds, i.id].join(',')}>{i.category ? `[${i.category}] ` : ''}{i.name} {i.spec ?? ''}</option>)}
        </select>
        <button className="btn">추가</button>
        <span className="sp" />
        <ExportCsv target="ordergrid" name={`${schoolName}_발주`} />
      </form>
      <form className="panel" id="ordergrid">
        <Back value={back} /><input type="hidden" name="school" value={schoolId} />
        {days.map((d) => <input key={d} type="hidden" name="day" value={d} />)}
        {days.map((d) => (lines.some((l) => l.delivery_date === d) ? <input key={'h' + d} type="hidden" name={`has_${d}`} value="1" /> : null))}
        <header>
          <h2>{schoolName} 주문서</h2>
          <div className="bar" style={{ margin: 0 }}>
            <button className="btn" formAction={draftWeek}>임시저장</button>
            <button className="btn pri" formAction={submitWeek}>제출</button>
          </div>
        </header>
        {!shown.length ? <Empty>이 기간 주문이 없습니다. 위에서 품목을 추가하세요.</Empty> : (
          <div className="tw"><table>
            <thead>
              <tr><th>상품</th><th>규격</th><th>단위</th><th>인증</th><th className="n">단가</th>
                {days.map((d) => <th key={d} className="n">{dlabel(d)}<br /><span style={{ fontWeight: 400 }}>{dayState(d)}</span></th>)}
                <th className="n">총수량</th><th className="n">금액</th></tr>
            </thead>
            <tbody>{shown.map((i) => {
              const price = priceOf(i);
              const il = lines.filter((l) => l.item_id === i.id);
              return (
                <tr key={i.id}>
                  <td>{i.name}</td><td className="dim">{i.spec}</td><td>{i.unit}</td><td>{i.cert_type}</td>
                  <td className="n">{price != null ? won(price) : <span style={{ color: 'var(--bad)' }}>단가없음</span>}</td>
                  {days.map((d) => {
                    const l = il.find((x) => x.delivery_date === d);
                    const s = suspended(i.id, d);
                    const editable = d > t && (!l || l.status === 'draft' || l.status === 'submitted') && price != null && !s;
                    return (
                      <td key={d} className="n" title={s ? `공급중단: ${s.reason ?? ''}` : l ? STATUS[l.status] : undefined}>
                        {editable
                          ? <input className="q" type="number" min="0" step="0.1" name={`q_${d}_${i.id}`} defaultValue={l?.qty ?? ''} aria-label={`${i.name} ${dlabel(d)} 수량`} />
                          : l ? <span>{qty(l.qty)} <span className={`pill s-${l.status}`} style={{ padding: '1px 5px' }}>{STATUS[l.status].slice(0, 2)}</span></span>
                          : s ? <span className="pill s-open" style={{ padding: '1px 5px' }}>중단</span> : <span className="dim">—</span>}
                      </td>
                    );
                  })}
                  <td className="n">{qty(sumBy(il, (l) => Number(l.qty)))}</td>
                  <td className="n">{won(sumBy(il, (l) => Number(l.amount)))}</td>
                </tr>
              );
            })}</tbody>
            <tfoot><tr><td colSpan={6 + days.length}>합계 (공급가액)</td><td className="n">{won(sumBy(lines, (l) => Number(l.amount)))}</td></tr></tfoot>
          </table></div>
        )}
      </form>
    </>
  );
}
