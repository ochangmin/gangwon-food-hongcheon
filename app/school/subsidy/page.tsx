import { requireProfile } from '@/lib/session';
import { won } from '@/lib/format';
import { PageHead, Empty } from '@/components/ui';

export default async function SchoolSubsidy() {
  const { sb, p } = await requireProfile(['school']);
  const [{ data: monthly }, { data: settle }, { data: yearly }] = await Promise.all([
    sb.from('subsidy_monthly').select('id,month,subsidy_type,students,meal_days,unit_price,amount').eq('school_id', p.school_id!).order('month', { ascending: false }),
    sb.from('subsidy_settlements').select('id,month,subsidy_type,budget,used,settled_amount,status').eq('school_id', p.school_id!).order('month', { ascending: false }),
    sb.from('subsidy_budgets').select('id,year,subsidy_type,amount').eq('school_id', p.school_id!).order('year', { ascending: false }),
  ]);
  return (
    <>
      <PageHead crumb={p.schools?.name ?? '학교'} title="보조금 현황" desc="센터에 등록된 우리 학교 보조금 예산과 월별 정산 결과입니다." />
      <section className="panel"><header><h2>연간 예산</h2></header>
        {!yearly?.length ? <Empty>등록된 연간 예산이 없습니다.</Empty> : (
          <div className="tw"><table><thead><tr><th>연도</th><th>보조금유형</th><th className="n">예산액</th></tr></thead>
            <tbody>{yearly.map((r) => <tr key={r.id}><td>{r.year}</td><td>{r.subsidy_type}</td><td className="n">{won(r.amount)}</td></tr>)}</tbody></table></div>)}
      </section>
      <section className="panel"><header><h2>월 지원예산</h2></header>
        {!monthly?.length ? <Empty>등록된 월 예산이 없습니다.</Empty> : (
          <div className="tw"><table><thead><tr><th>기준월</th><th>보조금유형</th><th className="n">학생수</th><th className="n">급식일수</th><th className="n">1인 단가</th><th className="n">지원예산</th></tr></thead>
            <tbody>{monthly.map((r) => <tr key={r.id}><td>{r.month}</td><td>{r.subsidy_type}</td><td className="n">{r.students ?? ''}</td><td className="n">{r.meal_days ?? ''}</td><td className="n">{r.unit_price ? won(r.unit_price) : ''}</td><td className="n">{won(r.amount)}</td></tr>)}</tbody></table></div>)}
      </section>
      <section className="panel"><header><h2>정산 결과</h2></header>
        {!settle?.length ? <Empty>정산 자료가 없습니다.</Empty> : (
          <div className="tw"><table><thead><tr><th>정산월</th><th>보조금유형</th><th className="n">지원예산</th><th className="n">집행</th><th className="n">정산액</th><th>상태</th></tr></thead>
            <tbody>{settle.map((r) => <tr key={r.id}><td>{r.month}</td><td>{r.subsidy_type}</td><td className="n">{won(r.budget)}</td><td className="n">{won(r.used)}</td><td className="n">{won(r.settled_amount)}</td><td><span className={`pill ${r.status === '정산완료' ? 's-delivered' : 's-draft'}`}>{r.status}</span></td></tr>)}</tbody></table></div>)}
      </section>
    </>
  );
}
