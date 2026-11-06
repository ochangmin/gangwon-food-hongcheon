import { requireCenter } from '@/lib/session';
import { type SP } from '@/lib/page';
import { won, qty, addDays, today } from '@/lib/format';
import { Flash, PageHead, Back, Empty } from '@/components/ui';
import { requestTrade, tradeStep } from '../actions2';

type M = { id: string; 판매센터: string; 상품: string; 규격: string | null; 단위: string; 공유단가: number; 공급시작: string; 공급종료: string | null; 최소수량: number | null; 비고: string | null };
type T = { id: string; 구분: string; 상대센터: string; 상품: string; 단위: string; 거래일: string; 수량: number; 단가: number; 금액: number; 상태: string; 비고: string | null };

export default async function Trades({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { sb, center } = await requireCenter(sp.center);
  const [{ data: m }, { data: t }] = await Promise.all([sb.rpc('shared_market', { p_center_id: center.id }), sb.rpc('my_trades', { p_center_id: center.id })]);
  const market = (m ?? []) as M[];
  const trades = (t ?? []) as T[];
  const back = `/center/trades${sp.center ? `?center=${sp.center}` : ''}`;
  const next = (x: T): string[] => (x.구분 === '매출' ? (x.상태 === '요청' ? ['승인', '반려'] : x.상태 === '승인' ? ['출고'] : []) : x.상태 === '출고' ? ['완료'] : []);
  return (
    <>
      <PageHead crumb={center.name} title="전체공유상품현황" umji="PU020020"
        desc="다른 시군 센터가 공유한 상품을 주문하고, 우리 센터가 받은 주문을 승인·출고합니다. 매입 쪽은 받은 뒤 완료를 눌러 마무리합니다." />
      <Flash msg={sp.msg} err={sp.err} />
      <section className="panel">
        <header><h2>다른 센터 공유상품</h2><small>{market.length}건</small></header>
        {!market.length ? <Empty>공유된 상품이 없습니다.</Empty> : (
          <div className="tw"><table>
            <thead><tr><th>판매센터</th><th>상품</th><th>규격</th><th className="n">공유단가</th><th>공급기간</th><th className="n">최소수량</th><th>주문</th></tr></thead>
            <tbody>{market.map((x) => (
              <tr key={x.id}>
                <td>{x.판매센터}</td><td>{x.상품}</td><td>{x.규격}</td><td className="n">{won(x.공유단가)}</td><td>{x.공급시작} ~ {x.공급종료 ?? ''}</td><td className="n">{x.최소수량 ?? ''}</td>
                <td>
                  <form action={requestTrade} className="bar" style={{ margin: 0, flexWrap: 'nowrap' }}>
                    <Back value={back} /><input type="hidden" name="center" value={center.id} /><input type="hidden" name="shared" value={x.id} />
                    <input type="date" name="date" defaultValue={addDays(today(), 3)} required aria-label="거래일" />
                    <input className="q" type="number" name="qty" min="0" step="0.1" required placeholder={x.단위} aria-label="수량" />
                    <button className="btn pri">요청</button>
                  </form>
                </td>
              </tr>))}</tbody>
          </table></div>
        )}
      </section>
      <section className="panel">
        <header><h2>우리 센터 거래</h2><small>매입·매출</small></header>
        {!trades.length ? <Empty>거래 내역이 없습니다.</Empty> : (
          <div className="tw"><table>
            <thead><tr><th>구분</th><th>상대센터</th><th>상품</th><th>거래일</th><th className="n">수량</th><th className="n">단가</th><th className="n">금액</th><th>상태</th><th /></tr></thead>
            <tbody>{trades.map((x) => (
              <tr key={x.id}>
                <td>{x.구분}</td><td>{x.상대센터}</td><td>{x.상품}</td><td>{x.거래일}</td><td className="n">{qty(x.수량)} {x.단위}</td><td className="n">{won(x.단가)}</td><td className="n">{won(x.금액)}</td>
                <td><span className={`pill ${x.상태 === '완료' ? 's-delivered' : x.상태 === '반려' ? 's-open' : 's-submitted'}`}>{x.상태}</span></td>
                <td className="bar" style={{ margin: 0 }}>{next(x).map((s) => (
                  <form key={s} action={tradeStep}><Back value={back} /><input type="hidden" name="id" value={x.id} /><input type="hidden" name="status" value={s} />
                    <button className={s === '반려' ? 'btn dan' : 'btn'}>{s}</button></form>))}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
