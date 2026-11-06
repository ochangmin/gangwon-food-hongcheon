import Link from 'next/link';
import { requireCenter } from '@/lib/session';
import { type SP } from '@/lib/page';
import { weekDays, monthWeekdays, dlabel, addDays, today, isDate } from '@/lib/format';
import { Flash, PageHead, Empty } from '@/components/ui';
import { OrderGrid } from '@/components/OrderGrid';

export default async function CenterOrderEntry({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { sb, center } = await requireCenter(sp.center);
  const month = sp.mode === 'month';
  const base = isDate(sp.date) ? sp.date! : addDays(today(), month ? 0 : 3);
  const days = month ? monthWeekdays(base) : weekDays(base);
  const { data: schools } = await sb.from('schools').select('id,code,name').eq('center_id', center.id).eq('active', true).order('code');
  const { data: counts } = await sb.from('order_lines').select('school_id,status').eq('center_id', center.id).gte('delivery_date', days[0]).lte('delivery_date', days[days.length - 1]);
  const school = schools?.find((s) => s.id === sp.school) ?? schools?.[0];
  const adds = (sp.add ?? '').split(',').filter(Boolean);
  const keep = `mode=${month ? 'month' : 'week'}${sp.center ? `&center=${sp.center}` : ''}`;
  const here = `/center/order-entry?${keep}&date=${base}&school=${school?.id ?? ''}`;
  const prev = month ? `${addDays(`${base.slice(0, 7)}-01`, -1).slice(0, 7)}-01` : addDays(days[0], -7);
  const next = month ? `${addDays(`${base.slice(0, 7)}-01`, 32).slice(0, 7)}-01` : addDays(days[0], 7);

  return (
    <>
      <PageHead crumb={center.name} title={month ? '발주등록(월간)' : '발주등록(주간)'} umji={month ? 'SA020010_MONTH' : 'SA020010'}
        desc="학교를 골라 센터가 대신 견적·주문을 입력합니다. 제출된 주문은 주문확정 화면에서 확정합니다." />
      <div className="bar">
        <Link className="btn" href={`/center/order-entry?${keep}&date=${prev}&school=${school?.id ?? ''}`}>‹ {month ? '이전 달' : '이전 주'}</Link>
        <span>{month ? `${base.slice(0, 4)}년 ${Number(base.slice(5, 7))}월` : `${dlabel(days[0])} ~ ${dlabel(days[4])}`}</span>
        <Link className="btn" href={`/center/order-entry?${keep}&date=${next}&school=${school?.id ?? ''}`}>{month ? '다음 달' : '다음 주'} ›</Link>
      </div>
      <Flash msg={sp.msg} err={sp.err} />
      {!school ? <section className="panel"><Empty>등록된 학교가 없습니다.</Empty></section> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 230px) minmax(0, 1fr)', gap: 16, alignItems: 'start' }} className="split-entry">
          <section className="panel">
            <header><h2>학교</h2><small>견적 / 미확정</small></header>
            <ul className="plist" style={{ listStyle: 'none', margin: 0, padding: 4 }}>
              {schools!.map((s) => {
                const c = (counts ?? []).filter((x) => x.school_id === s.id);
                const open = c.filter((x) => x.status === 'draft' || x.status === 'submitted').length;
                return (
                  <li key={s.id}>
                    <Link href={`/center/order-entry?${keep}&date=${base}&school=${s.id}`} className="schoolpick" aria-current={s.id === school.id ? 'page' : undefined}>
                      <span>{s.name}</span><span className="dim mono">{c.length} / {open}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
          <div style={{ minWidth: 0 }}>
            <OrderGrid sb={sb} schoolId={school.id} schoolName={school.name} days={days}
              back={`${here}${adds.length ? `&add=${adds.join(',')}` : ''}`} addPath={here} adds={adds} />
          </div>
        </div>
      )}
    </>
  );
}
