import { signIn } from './actions';
import { Flash } from '@/components/ui';

export default async function Login({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const { err } = await searchParams;
  return (
    <div className="login">
      <div className="brand" style={{ marginBottom: 18 }}>
        <svg width="34" height="34" viewBox="0 0 30 30" aria-hidden="true">
          <rect x="1" y="1" width="28" height="28" rx="6" fill="var(--accent)" />
          <path d="M7 19c3-6 6-8 8-8s5 2 8 8" stroke="var(--on-accent)" strokeWidth="2.4" fill="none" strokeLinecap="round" />
          <circle cx="15" cy="11" r="2.4" fill="var(--on-accent)" />
        </svg>
        <div>
          <b>강원 먹거리 이음</b>
          <small>학교급식 수발주 플랫폼</small>
        </div>
      </div>
      <Flash err={err} />
      <form className="panel" action={signIn}>
        <label>
          이메일
          <input type="email" name="email" required autoComplete="username" />
        </label>
        <label>
          비밀번호
          <input type="password" name="password" required autoComplete="current-password" />
        </label>
        <button className="btn pri" style={{ width: '100%', justifyContent: 'center' }}>로그인</button>
        <p className="dim" style={{ fontSize: 12, marginBottom: 0 }}>계정은 소속 학교급식지원센터에서 발급합니다.</p>
      </form>
    </div>
  );
}
