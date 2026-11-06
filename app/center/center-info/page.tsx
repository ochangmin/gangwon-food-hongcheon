import { requireCenter } from '@/lib/session';
import { type SP } from '@/lib/page';
import { Flash, PageHead, Back } from '@/components/ui';
import { saveCenterInfo } from '../actions2';

export default async function CenterInfo({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { sb, center } = await requireCenter(sp.center);
  const { data: c } = await sb.from('centers').select('*').eq('id', center.id).single();
  const back = `/center/center-info${sp.center ? `?center=${sp.center}` : ''}`;
  return (
    <>
      <PageHead crumb={center.name} title="센터정보" umji="MA010100" desc="거래명세서·발주서에 찍히는 센터 정보입니다. 센터코드는 로트·전표 번호의 접두어라 도 관리자만 바꿀 수 있습니다." />
      <Flash msg={sp.msg} err={sp.err} />
      <form className="panel pad form" action={saveCenterInfo}>
        <Back value={back} /><input type="hidden" name="center" value={center.id} />
        <label>센터코드<input type="text" value={c?.code ?? ''} disabled /></label>
        <label>센터명<input type="text" name="name" defaultValue={c?.name ?? ''} required /></label>
        <label>시군<input type="text" value={c?.sigungu ?? ''} disabled /></label>
        <label>대표자명<input type="text" name="ceo" defaultValue={c?.ceo_name ?? ''} /></label>
        <label>사업자번호<input type="text" name="biz" defaultValue={c?.biz_no ?? ''} /></label>
        <label>업태/종목<input type="text" name="btype" defaultValue={c?.business_type ?? ''} /></label>
        <label>전화번호<input type="text" name="tel" defaultValue={c?.tel ?? ''} /></label>
        <label>팩스번호<input type="text" name="fax" defaultValue={c?.fax ?? ''} /></label>
        <label className="wide">주소<input type="text" name="address" defaultValue={c?.address ?? ''} /></label>
        <label className="wide">비고<input type="text" name="note" defaultValue={c?.note ?? ''} /></label>
        <div><button className="btn pri">저장</button></div>
      </form>
    </>
  );
}
