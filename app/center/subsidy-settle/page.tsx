import { requireCenter } from '@/lib/session';
import { type SP, sumBy } from '@/lib/page';
import { won, today } from '@/lib/format';
import { Flash, PageHead, Back, Empty } from '@/components/ui';
import { ExportCsv } from '@/components/ExportCsv';
import { settleSubsidies, saveSettlement } from '../actions2';

type S = { id: string; month: string; subsidy_type: string; budget: number; used: number; settled_amount: number; status: string; note: string | null; schools: { name: string } };

export default async function SubsidySettle({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { sb, center } = await requireCenter(sp.center);
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? '') ? sp.month! : today().slice(0, 7);
  const { data } = await sb.from('subsidy_settlements').select('id,month,subsidy_type,budget,used,settled_amount,status,note,schools(name)').eq('center_id', center.id).eq('month', month).order('subsidy_type');
  const rows = ((data ?? []) as unknown as S[]).sort((a, b) => a.schools.name.localeCompare(b.schools.name));
  const back = `/center/subsidy-settle?month=${month}${sp.center ? `&center=${sp.center}` : ''}`;
  return (
    <>
      <PageHead crumb={center.name} title="보조금정산관리" umji="SU010030"
        desc="월 지원예산(보조금예산(월간))과 그 달 출고·배송된 보조금유형 상품 금액을 비교해 정산액을 계산합니다. 정산액은 예산과 사용액 중 작은 값으로 잡히며, 확인 후 정산완료로 바꿉니다." />
      <Flash msg={sp.msg} err={sp.err} />
      <div className="bar">
        <form className="bar" style={{ margin: 0 }} action="/center/subsidy-settle">
          {sp.center ? <input type="hidden" name="center" value={sp.center} /> : null}
          <label className="dim" style={{ fontSize: 13 }}>정산월 <input type="month" name="month" defaultValue={month} /></label>
          <button className="btn">조회</button>
        </form>
        <form action={settleSubsidies} style={{ margin: 0 }}>
          <Back value={back} /><input type="hidden" name="center" value={center.id} /><input type="hidden" name="month" value={month} />
          <button className="btn pri">정산 계산</button>
        </form>
        <span className="sp" /><ExportCsv target="settle" name={`보조금정산_${month}`} />
      </div>
      <section className="panel" id="settle">
        {!rows.length ? <Empty>{month} 정산 자료가 없습니다. 보조금예산(월간)을 등록한 뒤 정산 계산을 누르세요.</Empty> : (
          <div className="tw"><table>
            <thead><tr><th>학교명</th><th>보조금유형</th><th className="n">지원예산(MB)</th><th className="n">집행(MR)</th><th className="n">잔액</th><th>정산액 · 상태 · 비고</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}>
                <td>{r.schools.name}</td><td>{r.subsidy_type}</td><td className="n">{won(r.budget)}</td><td className="n">{won(r.used)}</td><td className="n">{won(Number(r.budget) - Number(r.used))}</td>
                <td>
                  <form action={saveSettlement} className="bar" style={{ margin: 0, flexWrap: 'nowrap' }}>
                    <Back value={back} /><input type="hidden" name="id" value={r.id} />
                    <input className="q" type="number" name="amount" defaultValue={r.settled_amount} aria-label="정산액" style={{ width: 110 }} />
                    <select name="status" defaultValue={r.status} aria-label="상태"><option>미정산</option><option>정산완료</option></select>
                    <input type="text" name="note" defaultValue={r.note ?? ''} placeholder="비고" aria-label="비고" style={{ width: 120 }} />
                    <button className="btn">저장</button>
                  </form>
                </td>
              </tr>))}</tbody>
            <tfoot><tr><td colSpan={2}>합계</td><td className="n">{won(sumBy(rows, (r) => Number(r.budget)))}</td><td className="n">{won(sumBy(rows, (r) => Number(r.used)))}</td><td className="n">{won(sumBy(rows, (r) => Number(r.budget) - Number(r.used)))}</td><td>정산액 {won(sumBy(rows, (r) => Number(r.settled_amount)))}원</td></tr></tfoot>
          </table></div>
        )}
      </section>
    </>
  );
}
