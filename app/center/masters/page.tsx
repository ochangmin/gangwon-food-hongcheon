import Link from 'next/link';
import { requireCenter } from '@/lib/session';
import { type SP } from '@/lib/page';
import { won, STORAGE, today } from '@/lib/format';
import { Flash, PageHead, Back, Empty } from '@/components/ui';
import { addSchool, addSupplier, addItem, addPrice, saveCourse, assignCourse } from '../actions';

const TABS = { schools: '학교(납품처)', items: '상품·단가', suppliers: '공급업체', courses: '배송코스·차량' } as const;
type Tab = keyof typeof TABS;

export default async function Masters({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { sb, center } = await requireCenter(sp.center);
  const tab: Tab = (sp.tab && sp.tab in TABS ? sp.tab : 'schools') as Tab;
  const cq = sp.center ? `&center=${sp.center}` : '';
  const back = `/center/masters?tab=${tab}${cq}`;
  const [{ data: schools }, { data: suppliers }, { data: courses }] = await Promise.all([
    sb.from('schools').select('id,code,name,school_level,meals,neis_code,course_id,delivery_seq,external_ref').eq('center_id', center.id).order('code'),
    sb.from('suppliers').select('id,code,name,kind,biz_no,area,phone,external_ref').eq('center_id', center.id).order('code'),
    sb.from('courses').select('id,code,name,vehicle_no,driver_name,depart_time').eq('center_id', center.id).order('code'),
  ]);
  const Hidden = () => (<><Back value={back} /><input type="hidden" name="center" value={center.id} /></>);

  let body: React.ReactNode = null;
  if (tab === 'schools') {
    body = (
      <>
        <section className="panel"><div className="tw"><table>
          <thead><tr><th>납품처코드</th><th>학교명</th><th>구분</th><th className="n">급식 인원</th><th>NEIS</th><th>배송코스 · 순서</th><th>연계</th></tr></thead>
          <tbody>{(schools ?? []).map((s) => (
            <tr key={s.id}>
              <td className="mono">{s.code}</td><td>{s.name}</td><td>{s.school_level}</td><td className="n">{s.meals}</td><td className="mono">{s.neis_code}</td>
              <td>
                <form action={assignCourse} className="bar" style={{ margin: 0, flexWrap: 'nowrap' }}>
                  <Back value={back} /><input type="hidden" name="school" value={s.id} />
                  <select name="course" defaultValue={s.course_id ?? ''} aria-label="배송코스"><option value="">미배정</option>{(courses ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                  <input className="q" type="number" name="seq" min="1" defaultValue={s.delivery_seq ?? ''} aria-label="배송순서" style={{ width: 60 }} />
                  <button className="btn">저장</button>
                </form>
              </td>
              <td className="mono dim">{s.external_ref ?? ''}</td>
            </tr>))}</tbody>
        </table></div></section>
        <form className="panel pad" action={addSchool}>
          <Hidden /><h2 style={{ marginBottom: 10 }}>학교 등록</h2>
          <div className="form">
            <label>납품처코드<input type="text" name="code" required /></label>
            <label>학교명<input type="text" name="name" required /></label>
            <label>구분<select name="level"><option>초</option><option>중</option><option>고</option><option>특수</option><option>유치원</option></select></label>
            <label>급식 인원<input type="number" name="meals" min="0" /></label>
            <label>NEIS 학교코드<input type="text" name="neis" /></label>
            <label>배송코스<select name="course"><option value="">미배정</option>{(courses ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label>배송순서<input type="number" name="seq" min="1" /></label>
            <div><button className="btn pri">등록</button></div>
          </div>
        </form>
      </>
    );
  }

  if (tab === 'suppliers') {
    body = (
      <>
        <section className="panel"><div className="tw"><table>
          <thead><tr><th>코드</th><th>업체명</th><th>구분</th><th>사업자번호</th><th>소재지</th><th>연락처</th><th>연계</th></tr></thead>
          <tbody>{(suppliers ?? []).map((s) => (
            <tr key={s.id}><td className="mono">{s.code}</td><td>{s.name}</td><td>{s.kind}</td><td className="mono">{s.biz_no}</td><td>{s.area}</td><td>{s.phone}</td><td className="mono dim">{s.external_ref ?? ''}</td></tr>))}</tbody>
        </table></div></section>
        <form className="panel pad" action={addSupplier}>
          <Hidden /><h2 style={{ marginBottom: 10 }}>공급업체 등록</h2>
          <div className="form">
            <label>코드<input type="text" name="code" required /></label>
            <label>업체명<input type="text" name="name" required /></label>
            <label>구분<select name="kind"><option>농산물</option><option>축산물</option><option>수산물</option><option>가공품</option><option>과일</option></select></label>
            <label>사업자번호<input type="text" name="biz" /></label>
            <label>소재지<input type="text" name="area" /></label>
            <label>연락처<input type="text" name="phone" /></label>
            <div><button className="btn pri">등록</button></div>
          </div>
        </form>
      </>
    );
  }

  if (tab === 'items') {
    const { data: items } = await sb.from('items').select('id,code,name,spec,unit,tax,category,cert_type,origin_detail,storage,suppliers(name),item_prices(sale_price,purchase_price,valid_from,valid_to)')
      .eq('center_id', center.id).order('code');
    const d = today();
    body = (
      <>
        <section className="panel"><div className="tw"><table>
          <thead><tr><th>코드</th><th>상품명</th><th>규격</th><th>단위</th><th>과세</th><th>공급업체</th><th>인증</th><th>보관</th><th className="n">현재 납품가</th><th className="n">매입가</th><th>새 단가</th></tr></thead>
          <tbody>{(items ?? []).map((i) => {
            const prices = (i.item_prices ?? []) as { sale_price: number; purchase_price: number; valid_from: string; valid_to: string }[];
            const p = prices.filter((x) => x.valid_from <= d && x.valid_to >= d).sort((a, b) => b.valid_from.localeCompare(a.valid_from))[0];
            return (
              <tr key={i.id}>
                <td className="mono">{i.code}</td><td>{i.name}</td><td>{i.spec}</td><td>{i.unit}</td><td>{i.tax === 'taxable' ? '과세' : '면세'}</td>
                <td>{(i.suppliers as unknown as { name: string } | null)?.name ?? <span style={{ color: 'var(--bad)' }}>미지정</span>}</td>
                <td>{i.cert_type}</td><td>{STORAGE[i.storage]}</td>
                <td className="n">{p ? won(p.sale_price) : <span style={{ color: 'var(--bad)' }}>없음</span>}</td><td className="n">{p ? won(p.purchase_price) : ''}</td>
                <td>
                  <form action={addPrice} className="bar" style={{ margin: 0, flexWrap: 'nowrap' }}>
                    <Back value={back} /><input type="hidden" name="item" value={i.id} />
                    <input className="q" type="number" name="sale" min="0" required placeholder="납품가" aria-label="납품가" />
                    <input className="q" type="number" name="purchase" min="0" required placeholder="매입가" aria-label="매입가" />
                    <input type="date" name="from" defaultValue={d} required aria-label="적용일" />
                    <button className="btn">적용</button>
                  </form>
                </td>
              </tr>);
          })}</tbody>
        </table></div></section>
        <form className="panel pad" action={addItem}>
          <Hidden /><h2 style={{ marginBottom: 10 }}>상품 등록</h2>
          <div className="form">
            <label>상품코드<input type="text" name="code" required pattern="[A-Za-z0-9_-]{1,20}" /></label>
            <label>상품명<input type="text" name="name" required /></label>
            <label>규격<input type="text" name="spec" /></label>
            <label>단위<input type="text" name="unit" defaultValue="kg" required /></label>
            <label>과세<select name="tax"><option value="exempt">면세</option><option value="taxable">과세</option></select></label>
            <label>공급업체<select name="supplier" required><option value="">선택</option>{(suppliers ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            <label>분류<input type="text" name="category" /></label>
            <label>인증<select name="cert"><option>일반</option><option>유기농</option><option>무농약</option><option>GAP</option><option>무항생제</option><option>동물복지</option><option>HACCP</option></select></label>
            <label>원산지 상세<input type="text" name="origin" placeholder={`강원 ${center.sigungu}`} /></label>
            <label>보관<select name="storage" defaultValue="chilled">{Object.entries(STORAGE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>납품가<input type="number" name="sale" min="0" /></label>
            <label>매입가<input type="number" name="purchase" min="0" /></label>
            <label>단가 적용일<input type="date" name="from" defaultValue={d} /></label>
            <div><button className="btn pri">등록</button></div>
          </div>
        </form>
      </>
    );
  }

  if (tab === 'courses') {
    body = (
      <>
        {(courses ?? []).map((co) => (
          <form key={co.id} className="panel pad" action={saveCourse}>
            <Hidden /><input type="hidden" name="id" value={co.id} />
            <div className="form">
              <label>코드<input type="text" value={co.code} disabled /></label>
              <label>코스명<input type="text" name="name" defaultValue={co.name} required /></label>
              <label>차량번호<input type="text" name="vehicle" defaultValue={co.vehicle_no ?? ''} /></label>
              <label>운행기사<input type="text" name="driver" defaultValue={co.driver_name ?? ''} /></label>
              <label>출발시간<input type="text" name="depart" defaultValue={co.depart_time?.slice(0, 5) ?? ''} placeholder="06:40" /></label>
              <div><button className="btn">저장</button></div>
            </div>
          </form>
        ))}
        {!courses?.length ? <section className="panel"><Empty>등록된 배송코스가 없습니다.</Empty></section> : null}
        <form className="panel pad" action={saveCourse}>
          <Hidden /><h2 style={{ marginBottom: 10 }}>배송코스 추가</h2>
          <div className="form">
            <label>코드<input type="text" name="code" required /></label>
            <label>코스명<input type="text" name="name" required /></label>
            <label>차량번호<input type="text" name="vehicle" /></label>
            <label>운행기사<input type="text" name="driver" /></label>
            <label>출발시간<input type="text" name="depart" placeholder="06:40" /></label>
            <div><button className="btn pri">추가</button></div>
          </div>
        </form>
      </>
    );
  }

  return (
    <>
      <PageHead crumb="기준정보" title="기준정보" umji="MA010210 · MA010110 · LG020010"
        desc="학교, 상품·단가, 공급업체, 배송코스를 관리합니다. umji에서 연계된 항목은 연계 열에 umji 번호가 표시됩니다." />
      <Flash msg={sp.msg} err={sp.err} />
      <div className="bar" role="tablist">
        {(Object.keys(TABS) as Tab[]).map((k) => (
          <Link key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'btn pri' : 'btn'} href={`/center/masters?tab=${k}${cq}`}>{TABS[k]}</Link>
        ))}
      </div>
      {body}
    </>
  );
}
