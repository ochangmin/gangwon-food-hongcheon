import Link from 'next/link';
import { requireCenter } from '@/lib/session';
import { type SP } from '@/lib/page';
import { qty, dlabel, STATUS } from '@/lib/format';
import { Flash, PageHead, Back, Empty } from '@/components/ui';
import { ExportCsv } from '@/components/ExportCsv';
import { approveChange, rejectChange } from '../actions2';

type R = { id: string; item_name: string | null; delivery_date: string | null; status: string; old_qty: number; requested_qty: number; reason: string | null; reply: string | null; created_at: string; processed_at: string | null;
  schools: { name: string }; order_lines: { delivery_date: string; status: string; items: { name: string; unit: string } } | null };

export default async function Changes({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { sb, center } = await requireCenter(sp.center);
  const history = sp.view === 'history';
  let q = sb.from('order_change_requests').select('id,status,old_qty,requested_qty,reason,reply,created_at,item_name,delivery_date,processed_at,schools(name),order_lines(delivery_date,status,items(name,unit))')
    .eq('center_id', center.id).order('created_at', { ascending: false }).limit(300);
  q = history ? q.neq('status', '요청') : q.eq('status', '요청');
  const { data } = await q;
  const rows = (data ?? []) as unknown as R[];
  const back = `/center/changes${history ? '?view=history' : ''}${sp.center ? `${history ? '&' : '?'}center=${sp.center}` : ''}`;
  const t = (s: string | null) => (s ? new Date(s).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

  return (
    <>
      <PageHead crumb={center.name} title={history ? '주문변경내역' : '주문변경요청'} umji={history ? 'SA020122' : 'SA020015'}
        desc={history ? '처리된 주문 변경 요청 이력입니다.' : '학교가 보낸 수량 변경 요청입니다. 승인하면 주문 수량과 공급업체 발주 수량이 함께 바뀝니다. 입고된 품목은 변경할 수 없습니다.'} />
      <Flash msg={sp.msg} err={sp.err} />
      <div className="bar">
        <Link className={history ? 'btn' : 'btn pri'} href={`/center/changes${sp.center ? `?center=${sp.center}` : ''}`}>처리 대기</Link>
        <Link className={history ? 'btn pri' : 'btn'} href={`/center/changes?view=history${sp.center ? `&center=${sp.center}` : ''}`}>처리 내역</Link>
        <span className="sp" /><ExportCsv target="changes" name="주문변경" />
      </div>
      <section className="panel" id="changes">
        {!rows.length ? <Empty>{history ? '처리된 요청이 없습니다.' : '처리할 변경 요청이 없습니다.'}</Empty> : (
          <div className="tw"><table>
            <thead><tr><th>요청일시</th><th>학교</th><th>납품일</th><th>상품</th><th>주문상태</th><th className="n">기존수량</th><th className="n">요청수량</th><th>사유</th>{history ? <><th>결과</th><th>처리일시</th><th>답변</th></> : <th className="noexport">처리</th>}</tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}>
                <td>{t(r.created_at)}</td><td>{r.schools.name}</td><td>{r.delivery_date ? dlabel(r.delivery_date) : '—'}</td>
                <td>{r.item_name}</td><td>{r.order_lines ? STATUS[r.order_lines.status] : '취소됨'}</td>
                <td className="n">{qty(r.old_qty)}</td><td className="n"><b>{qty(r.requested_qty)}</b> {r.order_lines?.items.unit}</td><td className="wrap">{r.reason}</td>
                {history ? <><td><span className={`pill ${r.status === '승인' ? 's-delivered' : 's-open'}`}>{r.status}</span></td><td>{t(r.processed_at)}</td><td className="wrap">{r.reply}</td></> : (
                  <td className="noexport">
                    <form className="bar" style={{ margin: 0, flexWrap: 'nowrap' }}>
                      <Back value={back} /><input type="hidden" name="id" value={r.id} />
                      <input type="text" name="reply" placeholder="답변 (선택)" aria-label="답변" style={{ width: 140 }} />
                      <button className="btn pri" formAction={approveChange}>승인</button>
                      <button className="btn dan" formAction={rejectChange}>반려</button>
                    </form>
                  </td>
                )}
              </tr>))}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
