import { requireProfile } from '@/lib/session';
import { type SP } from '@/lib/page';
import { qty, CLAIM_STATUS } from '@/lib/format';
import { Flash, PageHead, Empty } from '@/components/ui';

type C = { id: string; claim_no: string; claim_date: string; type: string; qty: number; description: string | null; action: string | null; status: string;
  items: { name: string; unit: string }; lots: { lot_no: string } | null };

export default async function SchoolClaims({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { sb, p } = await requireProfile(['school']);
  const { data } = await sb.from('claims').select('id,claim_no,claim_date,type,qty,description,action,status,items(name,unit),lots(lot_no)')
    .eq('school_id', p.school_id!).order('claim_date', { ascending: false }).limit(100);
  const rows = (data ?? []) as unknown as C[];
  return (
    <>
      <PageHead crumb={p.schools?.name ?? '학교'} title="클레임" desc="접수한 클레임의 센터 조치와 처리상태입니다. 새 클레임은 납품·검수 화면에서 접수합니다." />
      <Flash msg={sp.msg} err={sp.err} />
      <section className="panel">
        {!rows.length ? <Empty>접수한 클레임이 없습니다.</Empty> : (
          <div className="tw"><table>
            <thead><tr><th>번호</th><th>접수일</th><th>상품</th><th>로트</th><th>유형</th><th className="n">수량</th><th>내용</th><th>조치</th><th>상태</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}><td className="mono">{r.claim_no}</td><td>{r.claim_date}</td><td>{r.items.name}</td><td className="mono">{r.lots?.lot_no ?? '—'}</td><td>{r.type}</td>
                <td className="n">{qty(r.qty)} {r.items.unit}</td><td className="wrap">{r.description}</td><td>{r.action ?? '—'}</td>
                <td><span className={`pill s-${r.status}`}>{CLAIM_STATUS[r.status]}</span></td></tr>))}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
