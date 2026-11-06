import { requireCenter } from '@/lib/session';
import { type SP } from '@/lib/page';
import { Flash, PageHead, Back, Empty } from '@/components/ui';
import { createAccount } from '../actions';

const ROLE: Record<string, string> = { center_admin: '센터 관리자', school: '학교', supplier: '공급업체', province_admin: '도 관리자' };

export default async function Users({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { sb, p, center } = await requireCenter(sp.center);
  const [{ data: users }, { data: schools }, { data: suppliers }] = await Promise.all([
    sb.from('profiles').select('id,name,role,phone,created_at,schools(name),suppliers(name)').eq('center_id', center.id).order('role').order('name'),
    sb.from('schools').select('id,name').eq('center_id', center.id).eq('active', true).order('name'),
    sb.from('suppliers').select('id,name').eq('center_id', center.id).eq('active', true).order('name'),
  ]);
  const back = `/center/users${sp.center ? `?center=${sp.center}` : ''}`;

  return (
    <>
      <PageHead crumb="기준정보" title="계정 관리" desc="학교 영양교사와 공급업체 담당자 계정을 발급합니다. 처음 로그인한 뒤 비밀번호를 바꾸도록 안내하세요." />
      <Flash msg={sp.msg} err={sp.err} />
      <section className="panel">
        {!users?.length ? <Empty>발급된 계정이 없습니다.</Empty> : (
          <div className="tw"><table>
            <thead><tr><th>이름</th><th>역할</th><th>소속</th><th>연락처</th><th>발급일</th></tr></thead>
            <tbody>{users.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td><td>{ROLE[u.role]}</td>
                <td>{(u.schools as unknown as { name: string } | null)?.name ?? (u.suppliers as unknown as { name: string } | null)?.name ?? center.name}</td>
                <td>{u.phone}</td><td>{u.created_at?.slice(0, 10)}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </section>
      <form className="panel pad" action={createAccount}>
        <Back value={back} /><input type="hidden" name="center" value={center.id} />
        <h2 style={{ marginBottom: 10 }}>계정 발급</h2>
        <div className="form">
          <label>역할<select name="role">
            <option value="school">학교 영양교사</option><option value="supplier">공급업체</option>
            {p.role === 'province_admin' ? <option value="center_admin">센터 관리자</option> : null}
          </select></label>
          <label>소속 (학교 또는 공급업체)<select name="org">
            <optgroup label="학교">{(schools ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>
            <optgroup label="공급업체">{(suppliers ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>
          </select></label>
          <label>이름<input type="text" name="name" required /></label>
          <label>이메일<input type="email" name="email" required /></label>
          <label>임시 비밀번호<input type="text" name="password" required minLength={8} /></label>
          <label>연락처<input type="text" name="phone" /></label>
          <div><button className="btn pri">발급</button></div>
        </div>
      </form>
    </>
  );
}
