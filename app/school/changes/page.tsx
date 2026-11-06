import { requireProfile } from '@/lib/session';
import { type SP } from '@/lib/page';
import { qty, dlabel, today, STATUS } from '@/lib/format';
import { Flash, PageHead, Back, Empty } from '@/components/ui';
import { requestChange } from '../actions';

type L = { id: string; delivery_date: string; item_name: string; unit: string; qty: number; status: string };
type R = { id: string; item_name: string | null; delivery_date: string | null; status: string; old_qty: number; requested_qty: number; reason: string | null; reply: string | null; created_at: string; order_lines: { delivery_date: string; items: { name: string } } | null };

export default async function SchoolChanges({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { sb, p } = await requireProfile(['school']);
  const [{ data: lData }, { data: rData }] = await Promise.all([
    sb.from('v_order_lines').select('id,delivery_date,item_name,unit,qty,status').eq('school_id', p.school_id!).gt('delivery_date', today()).eq('status', 'confirmed').order('delivery_date').order('item_name'),
    sb.from('order_change_requests').select('id,status,old_qty,requested_qty,reason,reply,created_at,item_name,delivery_date,order_lines(delivery_date,items(name))').eq('school_id', p.school_id!).order('created_at', { ascending: false }).limit(100),
  ]);
  const lines = (lData ?? []) as L[];
  const reqs = (rData ?? []) as unknown as R[];
  return (
    <>
      <PageHead crumb={p.schools?.name ?? '학교'} title="주문변경요청" umji="SA020015"
        desc="센터가 확정한 주문의 수량을 바꿔야 할 때 요청합니다. 확정 전 주문은 주간 주문 화면에서 바로 고치면 됩니다. 0으로 요청하면 취소 요청입니다." />
      <Flash msg={sp.msg} err={sp.err} />
      <section className="panel">
        <header><h2>확정된 주문</h2><small>입고 전 품목만 변경할 수 있습니다</small></header>
        {!lines.length ? <Empty>변경할 수 있는 확정 주문이 없습니다.</Empty> : (
          <div className="tw"><table>
            <thead><tr><th>납품일</th><th>상품</th><th>상태</th><th className="n">현재수량</th><th>변경 요청</th></tr></thead>
            <tbody>{lines.map((l) => (
              <tr key={l.id}>
                <td>{dlabel(l.delivery_date)}</td><td>{l.item_name}</td><td>{STATUS[l.status]}</td><td className="n">{qty(l.qty)} {l.unit}</td>
                <td>
                  <form action={requestChange} className="bar" style={{ margin: 0, flexWrap: 'nowrap' }}>
                    <Back value="/school/changes" /><input type="hidden" name="line" value={l.id} />
                    <input className="q" type="number" name="qty" min="0" step="0.1" required aria-label="요청수량" placeholder="수량" />
                    <input type="text" name="reason" placeholder="사유" required aria-label="사유" style={{ width: 160 }} />
                    <button className="btn">요청</button>
                  </form>
                </td>
              </tr>))}</tbody>
          </table></div>
        )}
      </section>
      <section className="panel">
        <header><h2>요청 내역</h2></header>
        {!reqs.length ? <Empty>보낸 요청이 없습니다.</Empty> : (
          <div className="tw"><table>
            <thead><tr><th>요청일</th><th>납품일</th><th>상품</th><th className="n">기존</th><th className="n">요청</th><th>사유</th><th>결과</th><th>센터 답변</th></tr></thead>
            <tbody>{reqs.map((r) => (
              <tr key={r.id}>
                <td>{r.created_at.slice(0, 10)}</td><td>{r.delivery_date ? dlabel(r.delivery_date) : '—'}</td><td>{r.item_name}</td>
                <td className="n">{qty(r.old_qty)}</td><td className="n">{qty(r.requested_qty)}</td><td className="wrap">{r.reason}</td>
                <td><span className={`pill ${r.status === '승인' ? 's-delivered' : r.status === '반려' ? 's-open' : 's-submitted'}`}>{r.status === '요청' ? '처리 대기' : r.status}</span></td>
                <td className="wrap">{r.reply}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
