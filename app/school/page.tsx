import Link from 'next/link';
import { requireProfile } from '@/lib/session';
import { type SP, sumBy } from '@/lib/page';
import { won, qty, weekDays, dlabel, addDays, today, isDate, STATUS } from '@/lib/format';
import { Flash, PageHead, Back, Empty } from '@/components/ui';
import { draftWeek, submitWeek } from './actions';

type Item = { id: string; code: string; name: string; spec: string | null; unit: string; category: string | null; cert_type: string | null;
  suppliers: { name: string } | null; item_prices: { sale_price: number; valid_from: string; valid_to: string }[] };
type L = { item_id: string; delivery_date: string; qty: number; status: string; amount: number };

export default async function SchoolOrders({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { sb, p } = await requireProfile(['school']);
  const base = isDate(sp.date) ? sp.date! : addDays(today(), 3);
  const days = weekDays(base);
  const t = today();
  const adds = (sp.add ?? '').split(',').filter(Boolean);
  const [{ data: itemsData }, { data: linesData }] = await Promise.all([
    sb.from('items').select('id,code,name,spec,unit,category,cert_type,suppliers(name),item_prices(sale_price,valid_from,valid_to)').eq('active', true).order('category').order('name'),
    sb.from('v_order_lines').select('item_id,delivery_date,qty,status,amount').eq('school_id', p.school_id!).gte('delivery_date', days[0]).lte('delivery_date', days[4]),
  ]);
  const items = (itemsData ?? []) as unknown as Item[];
  const lines = (linesData ?? []) as L[];
  const shown = items.filter((i) => lines.some((l) => l.item_id === i.id) || adds.includes(i.id));
  const rest = items.filter((i) => !shown.includes(i));
  const priceOf = (i: Item) => i.item_prices.find((x) => x.valid_from <= days[0] && x.valid_to >= days[0])?.sale_price;
  const back = `/school?date=${base}${adds.length ? `&add=${adds.join(',')}` : ''}`;
  const dayState = (d: string) => {
    const ls = lines.filter((l) => l.delivery_date === d);
    if (!ls.length) return '';
    const st = ['draft', 'submitted', 'confirmed', 'received', 'shipped', 'delivered'].find((s) => ls.some((l) => l.status === s))!;
    return STATUS[st];
  };

  return (
    <>
      <PageHead crumb={p.schools?.name ?? '학교'} title="주간 주문" umji="SA020010"
        desc="요일별 수량을 입력해 임시저장하고, 준비되면 제출하세요. 센터가 확정한 칸과 납품일이 지난 칸은 잠깁니다." />
      <div className="bar">
        <Link className="btn" href={`/school?date=${addDays(days[0], -7)}`}>‹ 이전 주</Link>
        <span>{dlabel(days[0])} ~ {dlabel(days[4])}</span>
        <Link className="btn" href={`/school?date=${addDays(days[0], 7)}`}>다음 주 ›</Link>
      </div>
      <Flash msg={sp.msg} err={sp.err} />
      <form className="bar" action="/school">
        <input type="hidden" name="date" value={base} />
        <select name="add" aria-label="품목 추가" defaultValue="">
          <option value="" disabled>품목 추가…</option>
          {rest.map((i) => <option key={i.id} value={[...adds, i.id].join(',')}>{i.category ? `[${i.category}] ` : ''}{i.name} {i.spec ?? ''}</option>)}
        </select>
        <button className="btn">추가</button>
      </form>
      <form className="panel">
        <Back value={back} /><input type="hidden" name="school" value={p.school_id!} />
        {days.map((d) => <input key={d} type="hidden" name="day" value={d} />)}
        {days.map((d) => lines.some((l) => l.delivery_date === d) ? <input key={'h' + d} type="hidden" name={`has_${d}`} value="1" /> : null)}
        <header>
          <h2>{p.schools?.name} 주문서</h2>
          <div className="bar" style={{ margin: 0 }}>
            <button className="btn" formAction={draftWeek}>임시저장</button>
            <button className="btn pri" formAction={submitWeek}>제출</button>
          </div>
        </header>
        {!shown.length ? <Empty>이번 주 주문이 없습니다. 위에서 품목을 추가하세요.</Empty> : (
          <div className="tw"><table>
            <thead>
              <tr><th>상품</th><th>규격</th><th>단위</th><th>인증</th><th className="n">단가</th>
                {days.map((d) => <th key={d} className="n">{dlabel(d)}<br /><span style={{ fontWeight: 400 }}>{dayState(d)}</span></th>)}
                <th className="n">주간 금액</th></tr>
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
                    const editable = d > t && (!l || l.status === 'draft' || l.status === 'submitted') && price != null;
                    return (
                      <td key={d} className="n">
                        {editable
                          ? <input className="q" type="number" min="0" step="0.1" name={`q_${d}_${i.id}`} defaultValue={l?.qty ?? ''} aria-label={`${i.name} ${dlabel(d)} 수량`} />
                          : l ? <span title={STATUS[l.status]}>{qty(l.qty)} <span className={`pill s-${l.status}`} style={{ padding: '1px 5px' }}>{STATUS[l.status].slice(0, 2)}</span></span> : <span className="dim">—</span>}
                      </td>
                    );
                  })}
                  <td className="n">{won(sumBy(il, (l) => Number(l.amount)))}</td>
                </tr>
              );
            })}</tbody>
            <tfoot><tr><td colSpan={5 + days.length}>합계 (공급가액)</td><td className="n">{won(sumBy(lines, (l) => Number(l.amount)))}</td></tr></tfoot>
          </table></div>
        )}
      </form>
    </>
  );
}
