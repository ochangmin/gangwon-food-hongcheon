import Link from 'next/link';
import { requireCenter } from '@/lib/session';
import { ctx, type SP } from '@/lib/page';
import { addDays, today } from '@/lib/format';
import { DateBar, PageHead, Empty } from '@/components/ui';

export default async function Prints({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { sb, center } = await requireCenter(sp.center);
  const c = ctx('/center/prints', sp, addDays(today(), 1));
  const cq = sp.center ? `?center=${sp.center}` : '';
  const [{ data: ships }, { data: pos }] = await Promise.all([
    sb.from('shipments').select('id,statement_no,schools(name)').eq('center_id', center.id).eq('delivery_date', c.date).order('statement_no'),
    sb.from('purchase_orders').select('id,po_no,suppliers(name)').eq('center_id', center.id).eq('delivery_date', c.date).order('po_no'),
  ]);
  return (
    <>
      <PageHead crumb={center.name} title="출력물모음" umji="FC030010" desc="납품일 기준 거래명세서·발주서·상차일보를 열어 인쇄합니다. 각 화면의 인쇄 버튼을 누르면 메뉴 없이 문서만 인쇄됩니다." />
      <DateBar path="/center/prints" date={c.date} keep={c.keep} />
      <div className="grid2">
        <section className="panel">
          <header><h2>거래명세서</h2><small>{ships?.length ?? 0}건</small></header>
          {!ships?.length ? <Empty>출고확정된 거래명세서가 없습니다.</Empty> : (
            <div className="tw"><table><tbody>{ships.map((s) => (
              <tr key={s.id}><td>{(s.schools as unknown as { name: string }).name}</td><td><Link className="mono" href={`/center/statement/${s.id}${cq}`}>{s.statement_no}</Link></td></tr>))}</tbody></table></div>
          )}
        </section>
        <section className="panel">
          <header><h2>발주서</h2><small>{pos?.length ?? 0}건</small></header>
          {!pos?.length ? <Empty>발주가 없습니다.</Empty> : (
            <div className="tw"><table><tbody>{pos.map((p) => (
              <tr key={p.id}><td>{(p.suppliers as unknown as { name: string }).name}</td><td><Link className="mono" href={`/center/po/${p.id}${cq}`}>{p.po_no}</Link></td></tr>))}</tbody></table></div>
          )}
        </section>
        <section className="panel pad">
          <h2>상차일보</h2>
          <p className="dim" style={{ fontSize: 13 }}>코스별 상차 순서와 피킹 리스트입니다.</p>
          <Link className="btn" href={`/center/delivery?date=${c.date}${sp.center ? `&center=${sp.center}` : ''}`}>상차일보 열기</Link>
        </section>
      </div>
    </>
  );
}
