import Link from 'next/link';
import { requireProfile } from '@/lib/session';
import { type SP } from '@/lib/page';
import { weekDays, monthWeekdays, dlabel, addDays, today, isDate } from '@/lib/format';
import { Flash, PageHead } from '@/components/ui';
import { OrderGrid } from '@/components/OrderGrid';

export default async function SchoolOrders({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { sb, p } = await requireProfile(['school']);
  const month = sp.mode === 'month';
  const base = isDate(sp.date) ? sp.date! : addDays(today(), month ? 0 : 3);
  const days = month ? monthWeekdays(base) : weekDays(base);
  const adds = (sp.add ?? '').split(',').filter(Boolean);
  const modeQ = month ? '&mode=month' : '';
  const back = `/school?date=${base}${modeQ}${adds.length ? `&add=${adds.join(',')}` : ''}`;
  const prev = month ? `${addDays(`${base.slice(0, 7)}-01`, -1).slice(0, 7)}-01` : addDays(days[0], -7);
  const next = month ? `${addDays(`${base.slice(0, 7)}-01`, 32).slice(0, 7)}-01` : addDays(days[0], 7);

  return (
    <>
      <PageHead crumb={p.schools?.name ?? '학교'} title={month ? '월간 주문' : '주간 주문'} umji={month ? 'SA020010_MONTH' : 'SA020010'}
        desc="납품일별 수량을 입력해 임시저장하고, 준비되면 제출하세요. 센터가 확정한 칸, 지난 날짜, 공급이 중단된 상품은 입력할 수 없습니다." />
      <div className="bar">
        <Link className="btn" href={`/school?date=${prev}${modeQ}`}>‹ {month ? '이전 달' : '이전 주'}</Link>
        <span>{month ? `${base.slice(0, 4)}년 ${Number(base.slice(5, 7))}월` : `${dlabel(days[0])} ~ ${dlabel(days[4])}`}</span>
        <Link className="btn" href={`/school?date=${next}${modeQ}`}>{month ? '다음 달' : '다음 주'} ›</Link>
      </div>
      <Flash msg={sp.msg} err={sp.err} />
      <OrderGrid sb={sb} schoolId={p.school_id!} schoolName={p.schools?.name ?? ''} days={days} back={back}
        addPath={`/school?date=${base}${modeQ}`} adds={adds} />
    </>
  );
}
