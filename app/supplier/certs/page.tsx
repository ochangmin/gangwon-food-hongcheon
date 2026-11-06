import { requireProfile } from '@/lib/session';
import { type SP } from '@/lib/page';
import { today } from '@/lib/format';
import { Flash, PageHead, Back, Empty } from '@/components/ui';
import { addCert } from '../actions';

export default async function SupplierCerts({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { sb, p } = await requireProfile(['supplier']);
  const { data } = await sb.from('certifications').select('id,cert_type,cert_no,issuer,valid_from,valid_to,note').eq('supplier_id', p.supplier_id!).order('valid_to', { ascending: false });
  const t = today();
  return (
    <>
      <PageHead crumb={p.suppliers?.name ?? '공급업체'} title="인증정보" umji="QC020010" desc="친환경·GAP 등 인증서를 등록합니다. 유효기간이 지나면 센터의 인증정보 검증 현황에 표시되니 갱신된 인증서를 미리 올려주세요." />
      <Flash msg={sp.msg} err={sp.err} />
      <section className="panel">
        {!data?.length ? <Empty>등록된 인증정보가 없습니다.</Empty> : (
          <div className="tw"><table><thead><tr><th>인증구분</th><th>인증번호</th><th>인증기관</th><th>유효기간</th><th>상태</th><th>비고</th></tr></thead>
            <tbody>{data.map((c) => (
              <tr key={c.id}><td>{c.cert_type}</td><td className="mono">{c.cert_no}</td><td>{c.issuer}</td><td>{c.valid_from} ~ {c.valid_to}</td>
                <td><span className={`pill ${c.valid_to < t ? 's-open' : 's-delivered'}`}>{c.valid_to < t ? '만료' : '유효'}</span></td><td>{c.note}</td></tr>))}</tbody></table></div>
        )}
      </section>
      <form className="panel pad form" action={addCert}>
        <Back value="/supplier/certs" />
        <h2 className="wide">인증정보 등록</h2>
        <label>인증구분<select name="type" required>{['유기농', '무농약', 'GAP', '무항생제', '동물복지', 'HACCP', '저탄소'].map((x) => <option key={x}>{x}</option>)}</select></label>
        <label>인증번호<input type="text" name="no" required /></label>
        <label>인증기관<input type="text" name="issuer" /></label>
        <label>유효시작일<input type="date" name="from" required /></label>
        <label>유효종료일<input type="date" name="to" required /></label>
        <label>비고<input type="text" name="note" /></label>
        <div><button className="btn pri">등록</button></div>
      </form>
    </>
  );
}
