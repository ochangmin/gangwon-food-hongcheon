import Link from 'next/link';
import { requireCenter } from '@/lib/session';
import { ctx, type SP, sumBy } from '@/lib/page';
import { won } from '@/lib/format';
import { DateBar, Flash, PageHead, Pill, Back, Empty } from '@/components/ui';
import { courseRun } from './actions';

export default async function CenterHome({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { sb, center } = await requireCenter(sp.center);
  const c = ctx('/center', sp);
  const [{ data: sum }, { data: courses }, { data: runs }, { data: schools }, { data: ships }, { data: pos }] = await Promise.all([
    sb.rpc('day_summary', { p_date: c.date }),
    sb.from('courses').select('id,code,name,vehicle_no,driver_name,depart_time').eq('center_id', center.id).eq('active', true).order('code'),
    sb.from('course_runs').select('course_id,status').eq('center_id', center.id).eq('run_date', c.date),
    sb.from('schools').select('id,course_id').eq('center_id', center.id).eq('active', true),
    sb.from('shipments').select('school_id').eq('center_id', center.id).eq('delivery_date', c.date),
    sb.from('purchase_orders').select('id,po_no,status,suppliers(name),po_lines(qty,received_qty)').eq('center_id', center.id).eq('delivery_date', c.date).order('po_no'),
  ]);
  const s = (sum ?? []).find((r: { center_id: string }) => r.center_id === center.id) ?? {};
  const n = (k: string) => Number((s as Record<string, number>)[k] ?? 0);
  const total = n('lines');
  const shipped = new Set((ships ?? []).map((x) => x.school_id));
  const runOf = (id: string) => (runs ?? []).find((r) => r.course_id === id)?.status ?? 'waiting';
  const keep = sp.center ? `&center=${sp.center}` : '';

  return (
    <>
      <PageHead crumb={center.name} title="오늘 현황" desc="납품일 기준으로 주문→발주→입고→출고→배송 진행을 봅니다." umji="MAIN" />
      <DateBar path="/center" date={c.date} keep={c.keep} />
      <Flash msg={c.msg} err={c.err} />
      <div className="kpis">
        <Kpi l="납품 학교" v={n('schools')} u="곳" />
        <Kpi l="주문 라인" v={total} u="건" />
        <Kpi l="확정 대기" v={n('submitted')} u="건" href={`/center/orders?date=${c.date}${keep}`} />
        <Kpi l="입고 대기" v={n('confirmed')} u="건" href={`/center/purchase?date=${c.date}${keep}`} />
        <Kpi l="출고 대기" v={n('received')} u="건" href={`/center/shipping?date=${c.date}${keep}`} />
        <Kpi l="배송완료" v={n('delivered')} u={`/ ${total}`} />
        <Kpi l="납품 금액" v={won(n('amount'))} u="원" />
        <Kpi l="미결 클레임" v={n('open_claims')} u="건" href={`/center/claims?date=${c.date}${keep}`} />
      </div>
      <div className="grid2">
        <section className="panel">
          <header><h2>배송코스 운행</h2><small>출고 학교 / 배정 학교</small></header>
          {courses?.length ? (
            <div className="tw"><table>
              <thead><tr><th>코스</th><th>차량</th><th>기사</th><th>출발</th><th className="n">출고</th><th>상태</th><th /></tr></thead>
              <tbody>{courses.map((co) => {
                const ss = (schools ?? []).filter((x) => x.course_id === co.id);
                const st = runOf(co.id);
                return (
                  <tr key={co.id}>
                    <td>{co.name}</td><td className="mono">{co.vehicle_no}</td><td>{co.driver_name}</td><td>{co.depart_time?.slice(0, 5)}</td>
                    <td className="n">{ss.filter((x) => shipped.has(x.id)).length} / {ss.length}</td>
                    <td><span className={`pill s-${st}`}>{st === 'waiting' ? '출발대기' : st === 'departed' ? '배송중' : '도착완료'}</span></td>
                    <td>{st !== 'arrived' ? (
                      <form action={courseRun}>
                        <Back value={c.back} /><input type="hidden" name="course" value={co.id} /><input type="hidden" name="date" value={c.date} />
                        <input type="hidden" name="action" value={st === 'waiting' ? 'depart' : 'arrive'} />
                        <button className={st === 'waiting' ? 'btn' : 'btn pri'}>{st === 'waiting' ? '출발' : '도착 완료'}</button>
                      </form>) : null}</td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          ) : <Empty>배송코스가 없습니다. 기준정보에서 등록하세요.</Empty>}
        </section>
        <section className="panel">
          <header><h2>공급업체 발주</h2><small>입고 / 발주 수량</small></header>
          {pos?.length ? (
            <div className="tw"><table>
              <thead><tr><th>발주번호</th><th>공급업체</th><th>상태</th><th className="n">입고/발주</th></tr></thead>
              <tbody>{pos.map((po) => {
                const lines = (po.po_lines ?? []) as { qty: number; received_qty: number | null }[];
                return (
                  <tr key={po.id}>
                    <td className="mono">{po.po_no}</td>
                    <td>{(po.suppliers as unknown as { name: string } | null)?.name}</td>
                    <td><Pill s={po.status} kind="po" /></td>
                    <td className="n">{sumBy(lines, (l) => Number(l.received_qty ?? 0))} / {sumBy(lines, (l) => Number(l.qty))}</td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          ) : <Empty>이 날짜에 생성된 발주가 없습니다.</Empty>}
        </section>
      </div>
    </>
  );
}

function Kpi({ l, v, u, href }: { l: string; v: number | string; u: string; href?: string }) {
  const body = (<><div className="l">{l}</div><div className="v">{v} <small>{u}</small></div></>);
  return href ? <Link className="kpi" href={href} style={{ color: 'inherit', textDecoration: 'none' }}>{body}</Link> : <div className="kpi">{body}</div>;
}
