import { requireCenter } from '@/lib/session';
import { type SP } from '@/lib/page';
import { qty, STORAGE } from '@/lib/format';
import { PageHead, Empty } from '@/components/ui';

type Lot = { id: string; lot_no: string; received_date: string; received_qty: number; storage: string; cert_type: string | null; cert_no: string | null;
  origin: string | null; origin_detail: string | null; items: { name: string; unit: string }; suppliers: { name: string } | null };

export default async function Lots({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { sb, center } = await requireCenter(sp.center);
  const q = (sp.q ?? '').trim();
  let query = sb.from('lots').select('id,lot_no,received_date,received_qty,storage,cert_type,cert_no,origin,origin_detail,items(name,unit),suppliers(name)')
    .eq('center_id', center.id).order('received_date', { ascending: false }).order('lot_no').limit(200);
  if (q) query = query.ilike('lot_no', `%${q}%`);
  const { data } = await query;
  const lots = (data ?? []) as unknown as Lot[];
  const { data: uses } = lots.length
    ? await sb.from('order_lines').select('lot_id,qty,status,schools(name)').in('lot_id', lots.map((l) => l.id))
    : { data: [] };
  const usesOf = (id: string) => (uses ?? []).filter((u) => u.lot_id === id) as unknown as { qty: number; schools: { name: string } }[];

  return (
    <>
      <PageHead crumb="품질" title="로트 추적" umji="LG040210"
        desc="로트번호로 공급업체·인증·입고 정보와 납품된 학교를 역추적합니다. 로트번호 형식은 센터코드-입고일-상품코드입니다." />
      <form className="bar">
        {sp.center ? <input type="hidden" name="center" value={sp.center} /> : null}
        <input type="text" name="q" defaultValue={q} placeholder="로트번호 (예: HC-261116-I01)" aria-label="로트번호 검색" style={{ minWidth: 'min(100%, 300px)' }} />
        <button className="btn">검색</button>
      </form>
      <section className="panel">
        {!lots.length ? <Empty>{q ? '일치하는 로트가 없습니다.' : '아직 입고된 로트가 없습니다.'}</Empty> : (
          <div className="tw"><table>
            <thead><tr><th>로트번호</th><th>입고일</th><th>상품</th><th>공급업체</th><th className="n">입고수량</th><th>보관</th><th>인증</th><th>원산지</th><th>납품 학교</th></tr></thead>
            <tbody>{lots.map((l) => {
              const u = usesOf(l.id);
              return (
                <tr key={l.id}>
                  <td className="mono">{l.lot_no}</td><td>{l.received_date}</td><td>{l.items.name}</td><td>{l.suppliers?.name}</td>
                  <td className="n">{qty(l.received_qty)} {l.items.unit}</td><td>{STORAGE[l.storage]}</td>
                  <td>{l.cert_type}{l.cert_no ? ` ${l.cert_no}` : ''}</td><td>{l.origin} {l.origin_detail}</td>
                  <td className="wrap">{u.map((x) => `${x.schools.name} ${qty(x.qty)}`).join(', ') || '—'}</td>
                </tr>);
            })}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
