import { Suspense } from 'react';
import type { Profile } from '@/lib/session';
import { Nav, type NavGroup } from './Nav';
import { signOut } from '@/app/login/actions';

const ROLE: Record<string, string> = {
  province_admin: '도 관리자',
  center_admin: '센터 관리자',
  school: '학교',
  supplier: '공급업체',
};

export function Shell({ p, groups, children }: { p: Profile; groups: NavGroup[]; children: React.ReactNode }) {
  const org = p.schools?.name ?? p.suppliers?.name ?? p.centers?.name ?? '강원특별자치도';
  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
            <rect x="1" y="1" width="28" height="28" rx="6" fill="var(--accent)" />
            <path d="M7 19c3-6 6-8 8-8s5 2 8 8" stroke="var(--on-accent)" strokeWidth="2.4" fill="none" strokeLinecap="round" />
            <circle cx="15" cy="11" r="2.4" fill="var(--on-accent)" />
          </svg>
          <div>
            <b>강원 먹거리 이음</b>
            <small>학교급식 수발주 플랫폼</small>
          </div>
        </div>
        <div className="who">
          <span className="role">{ROLE[p.role]}</span>
          <span>{org} · {p.name}</span>
          <form action={signOut}>
            <button className="btn">로그아웃</button>
          </form>
        </div>
      </header>
      <Suspense>
        <Nav groups={groups} />
      </Suspense>
      <main>{children}</main>
    </div>
  );
}
