import { requireCenter } from '@/lib/session';
import { ctx, type SP, groupBy, sumBy } from '@/lib/page';
import { qty, STORAGE, addDays, today } from '@/lib/format';
import { DateBar, Flash, PageHead, Back, Empty } from '@/components/ui';
import { courseRun } from '../actions';

type L = { school_id: string; item_name: string; unit: string; storage: string; qty: number; status: string };
const RUN: Record<string, string> = { waiting: '출발대기', departed: '배송중', arrived: '도착완료' };

export default async function Delivery({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { sb, center } = await requireCenter(sp.center);
  const c = ctx('/center/delivery', sp, addDays(today(), 1));
  const [{ data: courses }, { data: schools }, { data: runs }, { data: lines }] = await Promise.all([
    sb.from('courses').select('id,code,name,vehicle_no,driver_name,driver_phone,depart_time').eq('center_id', center.id).eq('active', true).order('code'),
    sb.from('schools').select('id,code,name,course_id,delivery_seq').eq('center_id', center.id).eq('active', true).order('delivery_seq'),
    sb.from('course_runs').select('course_id,status,departed_at,arrived_at').eq('center_id', center.id).eq('run_date', c.date),
    sb.from('v_order_lines').select('school_id,item_name,unit,storage,qty,status').eq('center_id', center.id).eq('delivery_date', c.date).in('status', ['received', 'shipped', 'delivered']),
  ]);
  const L = (lines ?? []) as L[];
  const t = (s?: string | null) => (s ? new Date(s).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' }) : '');

  return (
    <>
      <PageHead crumb="출고·배송" title="배송 운행" umji="SA020230 · LG020150"
        desc="코스별 상차 순서와 피킹 수량(상차일보)을 확인하고 출발·도착을 기록합니다. 도착 처리하면 출고 품목이 배송완료로 바뀝니다." />
      <DateBar path="/center/delivery" date={c.date} keep={c.keep} />
      <Flash msg={c.msg} err={c.err} />
      {!courses?.length ? <section className="panel"><Empty>배송코스가 없습니다. 기준정보에서 등록하세요.</Empty></section> : (
        <div className="grid2">{courses.map((co) => {
          const ss = (schools ?? []).filter((s) => s.course_id === co.id);
          const run = runs?.find((r) => r.course_id === co.id);
          const st = run?.status ?? 'waiting';
          const cl = L.filter((l) => ss.some((s) => s.id === l.school_id));
          const pick = [...groupBy(cl, (l) => l.item_name).entries()];
          return (
            <section className="panel" key={co.id}>
              <header>
                <h2>{co.name}</h2>
                <div className="bar" style={{ margin: 0 }}>
                  <span className={`pill s-${st}`}>{RUN[st]} {t(run?.arrived_at ?? run?.departed_at)}</span>
                  {(st === 'waiting' ? [['depart', '출발', 'btn']] : st === 'departed' ? [['arrive', '도착 완료', 'btn pri'], ['reset', '초기화', 'btn']] : [['reset', '초기화', 'btn']]).map(([a, label, cls]) => (
                    <form key={a} action={courseRun}>
                      <Back value={c.back} /><input type="hidden" name="course" value={co.id} /><input type="hidden" name="date" value={c.date} />
                      <input type="hidden" name="action" value={a} />
                      <button className={cls}>{label}</button>
                    </form>
                  ))}
                </div>
              </header>
              <div className="pad dim" style={{ paddingBottom: 0, fontSize: 13 }}>
                차량 <b className="mono">{co.vehicle_no ?? '—'}</b> · 기사 {co.driver_name ?? '—'} {co.driver_phone ?? ''} · 출발 {co.depart_time?.slice(0, 5) ?? '—'}
              </div>
              <div className="tw" style={{ marginTop: 10 }}><table>
                <thead><tr><th className="n">순서</th><th>학교</th><th>물류번호</th><th className="n">품목</th><th>출고</th></tr></thead>
                <tbody>{ss.map((s) => {
                  const sl = cl.filter((l) => l.school_id === s.id);
                  const out = sl.filter((l) => l.status !== 'received').length;
                  return (
                    <tr key={s.id}>
                      <td className="n">{s.delivery_seq ?? '—'}</td><td>{s.name}</td><td className="mono">{co.code}-{String(s.delivery_seq ?? 0).padStart(2, '0')}</td>
                      <td className="n">{sl.length}</td>
                      <td>{!sl.length ? <span className="dim">납품 없음</span> : out === sl.length ? <span className="pill s-shipped">출고 {out}</span> : <span className="pill s-received">{out}/{sl.length}</span>}</td>
                    </tr>);
                })}</tbody>
              </table></div>
              <details>
                <summary className="pad" style={{ paddingBlock: 10, borderTop: '1px solid var(--line)' }}>피킹 리스트 ({pick.length}품목)</summary>
                <div className="tw"><table>
                  <thead><tr><th>상품</th><th>보관</th><th className="n">총 수량</th></tr></thead>
                  <tbody>{pick.map(([name, ls]) => (
                    <tr key={name}><td>{name}</td><td>{STORAGE[ls[0].storage]}</td><td className="n">{qty(sumBy(ls, (l) => Number(l.qty)))} {ls[0].unit}</td></tr>))}</tbody>
                </table></div>
              </details>
            </section>
          );
        })}</div>
      )}
    </>
  );
}
