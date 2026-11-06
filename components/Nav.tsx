'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

export type NavGroup = { g: string; items: { href: string; label: string }[] };

export function Nav({ groups }: { groups: NavGroup[] }) {
  const path = usePathname();
  const sp = useSearchParams();
  // 날짜·센터 선택은 메뉴를 옮겨도 유지
  const carry = new URLSearchParams();
  ['date', 'center'].forEach((k) => {
    const v = sp.get(k);
    if (v) carry.set(k, v);
  });
  const qs = carry.toString() ? `?${carry}` : '';
  return (
    <nav aria-label="업무 메뉴">
      {groups.map((g) => (
        <div className="g" key={g.g}>
          <div className="gl">{g.g}</div>
          {g.items.map((i) => {
            const active = path === i.href || (i.href !== '/center' && path.startsWith(i.href + '/'));
            return (
              <Link key={i.href} href={i.href + qs} aria-current={active ? 'page' : undefined}>
                {i.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
