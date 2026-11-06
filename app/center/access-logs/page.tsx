import { requireCenter } from '@/lib/session';
import { type SP } from '@/lib/page';
import { PageHead, Empty } from '@/components/ui';
import { ExportCsv } from '@/components/ExportCsv';

const ACT: Record<string, string> = { login: '로그인', logout: '로그아웃' };

export default async function AccessLogs({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { sb, center } = await requireCenter(sp.center);
  const [{ data: logs }, { data: audit }] = await Promise.all([
    sb.from('access_logs').select('id,email,role,action,ip,user_agent,at').eq('center_id', center.id).order('at', { ascending: false }).limit(300),
    sb.from('audit_log').select('id,action,target,at,detail').eq('center_id', center.id).order('at', { ascending: false }).limit(300),
  ]);
  const t = (s: string) => new Date(s).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  return (
    <>
      <PageHead crumb={center.name} title="사용자정보접속로그" umji="UserInfoAccess" desc="센터 소속 사용자의 로그인 기록과 주요 업무 처리 기록(감사 로그)입니다. 최근 300건을 보여줍니다." />
      <div className="bar"><span className="sp" /><ExportCsv target="logs" name="접속로그" /></div>
      <section className="panel" id="logs">
        <header><h2>접속 기록</h2></header>
        {!logs?.length ? <Empty>접속 기록이 없습니다.</Empty> : (
          <div className="tw"><table>
            <thead><tr><th>일시</th><th>사용자</th><th>역할</th><th>구분</th><th>IP</th><th>브라우저</th></tr></thead>
            <tbody>{logs.map((l) => (<tr key={l.id}><td>{t(l.at)}</td><td>{l.email}</td><td>{l.role}</td><td>{ACT[l.action] ?? l.action}</td><td className="mono">{l.ip}</td><td className="wrap dim">{(l.user_agent ?? '').slice(0, 80)}</td></tr>))}</tbody>
          </table></div>
        )}
      </section>
      <section className="panel">
        <header><h2>업무 처리 기록</h2></header>
        {!audit?.length ? <Empty>처리 기록이 없습니다.</Empty> : (
          <div className="tw"><table>
            <thead><tr><th>일시</th><th>작업</th><th>대상</th><th>내용</th></tr></thead>
            <tbody>{audit.map((a) => (<tr key={a.id}><td>{t(a.at)}</td><td className="mono">{a.action}</td><td className="mono">{a.target}</td><td className="wrap mono dim">{a.detail ? JSON.stringify(a.detail).slice(0, 120) : ''}</td></tr>))}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
