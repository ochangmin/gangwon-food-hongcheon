import Link from 'next/link';
import { Shell } from '@/components/Shell';
import { requireProfile } from '@/lib/session';
import { ctx, type SP, sumBy } from '@/lib/page';
import { won } from '@/lib/format';
import { DateBar, PageHead, Empty } from '@/components/ui';

type Row = { center_id: string; center_name: string; sigungu: string; schools: number; lines: number; draft: number; submitted: number;
  confirmed: number; received: number; shipped: number; delivered: number; amount: number; open_claims: number };

export default async function Province({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { sb, p } = await requireProfile(['province_admin']);
  const c = ctx('/province', sp);
  const { data } = await sb.rpc('day_summary', { p_date: c.date });
  const rows = ((data ?? []) as Row[]).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'string' && /^\d+(\.\d+)?$/.test(v) ? Number(v) : v])) as Row);
  const tot = (k: keyof Row) => sumBy(rows, (r) => Number(r[k]));
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

  return (
    <Shell p={p}>
      <PageHead crumb="강원특별자치도" title="도 통합 현황" desc="시군 학교급식지원센터별 납품일 진행률과 미결 클레임입니다. 센터 이름을 누르면 그 센터 화면으로 들어갑니다." />
      <DateBar path="/province" date={c.date} />
      <div className="kpis">
        <div className="kpi"><div className="l">운영 센터</div><div className="v">{rows.length} <small>곳</small></div></div>
        <div className="kpi"><div className="l">납품 학교</div><div className="v">{tot('schools')} <small>곳</small></div></div>
        <div className="kpi"><div className="l">주문 라인</div><div className="v">{tot('lines')} <small>건</small></div></div>
        <div className="kpi"><div className="l">배송완료율</div><div className="v">{pct(tot('delivered'), tot('lines'))} <small>%</small></div></div>
        <div className="kpi"><div className="l">납품 금액</div><div className="v">{won(tot('amount'))} <small>원</small></div></div>
        <div className="kpi"><div className="l">미결 클레임</div><div className="v">{tot('open_claims')} <small>건</small></div></div>
      </div>
      <section className="panel">
        {!rows.length ? <Empty>등록된 센터가 없습니다.</Empty> : (
          <div className="tw"><table>
            <thead><tr><th>시군</th><th>센터</th><th className="n">학교</th><th className="n">라인</th><th className="n">작성중</th><th className="n">확정대기</th><th className="n">입고대기</th><th className="n">출고대기</th><th className="n">출고</th><th className="n">배송완료</th><th className="n">진행률</th><th className="n">금액</th><th className="n">미결 클레임</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.center_id}>
                <td>{r.sigungu}</td>
                <td><Link href={`/center?center=${r.center_id}&date=${c.date}`}>{r.center_name}</Link></td>
                <td className="n">{r.schools}</td><td className="n">{r.lines}</td><td className="n">{r.draft}</td><td className="n">{r.submitted}</td><td className="n">{r.confirmed}</td>
                <td className="n">{r.received}</td><td className="n">{r.shipped}</td><td className="n">{r.delivered}</td>
                <td className="n">{pct(r.delivered, r.lines)}%</td><td className="n">{won(r.amount)}</td><td className="n">{r.open_claims}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </section>
    </Shell>
  );
}
