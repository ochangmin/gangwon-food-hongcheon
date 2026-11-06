import { headers } from 'next/headers';
import { requireCenter } from '@/lib/session';
import { type SP } from '@/lib/page';
import { collectorSource } from '@/lib/collector';
import { Flash, PageHead, Back, Empty } from '@/components/ui';
import { umjiIngest } from '../actions';

export default async function Umji({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { sb, center } = await requireCenter(sp.center);
  const back = `/center/umji${sp.center ? `?center=${sp.center}` : ''}`;
  const [{ data: runs }, { data: errs }] = await Promise.all([
    sb.from('umji_sync_runs').select('id,source,started_at,row_count,mapped_count,status,message').eq('center_id', center.id).order('started_at', { ascending: false }).limit(20),
    sb.from('umji_staging').select('id,dataset,error,payload').eq('center_id', center.id).not('error', 'is', null).order('id', { ascending: false }).limit(20),
  ]);
  const h = await headers();
  const origin = `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('host')}`;
  const src = collectorSource(`${origin}/api/umji/ingest`, center.code);

  return (
    <>
      <PageHead crumb="연계" title="umji 연계" desc="umji(강원 먹거리 통합운영시스템)와 병행 운영하는 동안 umji 출고 데이터를 받아 이음에 반영합니다. 같은 행을 다시 보내도 중복되지 않습니다." />
      <Flash msg={sp.msg} err={sp.err} />
      <section className="panel">
        <header><h2>수집 이력</h2><small>최근 20회</small></header>
        {!runs?.length ? <Empty>아직 수집 이력이 없습니다.</Empty> : (
          <div className="tw"><table>
            <thead><tr><th>시각</th><th>방식</th><th className="n">적재</th><th className="n">반영</th><th>상태</th><th>메시지</th></tr></thead>
            <tbody>{runs.map((r) => (
              <tr key={r.id}>
                <td>{new Date(r.started_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</td><td>{r.source === 'collector' ? '수집기' : '수동 붙여넣기'}</td>
                <td className="n">{r.row_count}</td><td className="n">{r.mapped_count}</td>
                <td><span className={`pill ${r.status === 'mapped' ? 's-delivered' : r.status === 'failed' ? 's-open' : 's-draft'}`}>{r.status === 'mapped' ? '반영' : r.status === 'failed' ? '실패' : '적재'}</span></td>
                <td className="wrap">{r.message}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </section>
      {errs?.length ? (
        <section className="panel">
          <header><h2>반영 오류 행</h2><small>umji 원본을 확인하세요</small></header>
          <div className="tw"><table>
            <thead><tr><th>데이터셋</th><th>오류</th><th>원본</th></tr></thead>
            <tbody>{errs.map((e) => (<tr key={e.id}><td>{e.dataset}</td><td>{e.error}</td><td className="mono wrap">{JSON.stringify(e.payload).slice(0, 160)}</td></tr>))}</tbody>
          </table></div>
        </section>
      ) : null}
      <div className="grid2">
        <section className="panel pad">
          <h2>방법 1 · umji 화면에서 바로 보내기</h2>
          <ol className="dim" style={{ paddingLeft: 18, fontSize: 13 }}>
            <li>umji에 로그인해 <b>출고처리</b> 화면에서 기간을 정해 조회합니다.</li>
            <li>브라우저 개발자도구 콘솔(F12)에 아래 스크립트를 붙여넣고 실행합니다. 북마크로 저장해 두면 다음부터 클릭 한 번이면 됩니다.</li>
            <li>처음 한 번 수집 토큰을 입력합니다. 토큰은 서버 환경변수 <span className="mono">UMJI_INGEST_TOKENS</span>에 센터코드 <b className="mono">{center.code}</b>로 등록한 값입니다.</li>
          </ol>
          <textarea readOnly defaultValue={src} aria-label="수집 스크립트" />
        </section>
        <form className="panel pad" action={umjiIngest}>
          <Back value={back} /><input type="hidden" name="center" value={center.id} />
          <h2>방법 2 · JSON 붙여넣기</h2>
          <p className="dim" style={{ fontSize: 13 }}>umji 컬럼명(INV_SEQ, CUST_SEQ, ITEM_SEQ, QTY, PRICE, DELV_DATE 등)을 그대로 쓴 JSON 배열을 붙여넣습니다.</p>
          <div className="form">
            <label>데이터셋<select name="dataset"><option value="shipments">출고 라인 (SA020240 dsInv)</option><option value="schools">학교</option><option value="suppliers">공급업체</option><option value="items">상품</option></select></label>
            <label className="wide">행 (JSON 배열)<textarea name="rows" required placeholder='[{"INV_SEQ":"9001","INV_SERL":"1","DELV_DATE":"20261105","CUST_SEQ":"501","CUST_NM":"홍천초등학교","ITEM_SEQ":"7001","ITEM_NM":"양파","QTY":"25","PRICE":"1800"}]' /></label>
            <div><button className="btn pri">적재·반영</button></div>
          </div>
        </form>
      </div>
    </>
  );
}
