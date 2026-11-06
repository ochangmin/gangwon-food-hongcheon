import { requireCenter } from '@/lib/session';
import { type SP } from '@/lib/page';
import { qty, CLAIM_STATUS } from '@/lib/format';
import { Flash, PageHead, Back, Empty } from '@/components/ui';
import { claimStatus } from '../actions';

type C = { id: string; claim_no: string; claim_date: string; type: string; qty: number; description: string | null; action: string | null; status: string;
  schools: { name: string }; items: { name: string; unit: string }; lots: { lot_no: string; suppliers: { name: string } | null } | null };
const ACTIONS = ['교환', '반품', '감액', '추가배송', '주의조치'];

export default async function Claims({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { sb, center } = await requireCenter(sp.center);
  const show = sp.show === 'all' ? 'all' : 'open';
  let q = sb.from('claims').select('id,claim_no,claim_date,type,qty,description,action,status,schools(name),items(name,unit),lots(lot_no,suppliers(name))')
    .eq('center_id', center.id).order('claim_date', { ascending: false }).limit(200);
  if (show === 'open') q = q.neq('status', 'closed');
  const { data } = await q;
  const rows = (data ?? []) as unknown as C[];
  const base = `/center/claims?show=${show}${sp.center ? `&center=${sp.center}` : ''}`;

  return (
    <>
      <PageHead crumb="품질" title="클레임" umji="QC010110" desc="학교 검수 클레임을 확인하고 조치와 처리상태를 기록합니다. 로트는 납품 이력에서 자동 연결됩니다." />
      <Flash msg={sp.msg} err={sp.err} />
      <div className="bar">
        <a className={show === 'open' ? 'btn pri' : 'btn'} href={base.replace(/show=\w+/, 'show=open')}>미결</a>
        <a className={show === 'all' ? 'btn pri' : 'btn'} href={base.replace(/show=\w+/, 'show=all')}>전체</a>
      </div>
      <section className="panel">
        {!rows.length ? <Empty>{show === 'open' ? '미결 클레임이 없습니다.' : '클레임이 없습니다.'}</Empty> : (
          <div className="tw"><table>
            <thead><tr><th>번호</th><th>접수일</th><th>학교</th><th>상품</th><th>로트 · 공급업체</th><th>유형</th><th className="n">수량</th><th>내용</th><th>조치 · 상태</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}>
                <td className="mono">{r.claim_no}</td><td>{r.claim_date}</td><td>{r.schools.name}</td><td>{r.items.name}</td>
                <td><span className="mono">{r.lots?.lot_no ?? '—'}</span> {r.lots?.suppliers?.name}</td>
                <td>{r.type}</td><td className="n">{qty(r.qty)} {r.items.unit}</td><td className="wrap">{r.description}</td>
                <td>
                  <form action={claimStatus} className="bar" style={{ margin: 0, flexWrap: 'nowrap' }}>
                    <Back value={base} /><input type="hidden" name="id" value={r.id} />
                    <select name="action" defaultValue={r.action ?? ''} aria-label="조치"><option value="">조치 선택</option>{ACTIONS.map((a) => <option key={a}>{a}</option>)}</select>
                    <select name="status" defaultValue={r.status} aria-label="처리상태">{Object.entries(CLAIM_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                    <button className="btn">저장</button>
                  </form>
                </td>
              </tr>))}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
