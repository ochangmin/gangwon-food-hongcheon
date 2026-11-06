'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import type { Top } from '@/lib/menu';

/** 메뉴 항목이 현재 주소와 맞는가: 경로가 같고, 항목에 쿼리가 있으면 그 값도 같아야 함 */
function matches(href: string, path: string, sp: URLSearchParams) {
  const [p, q] = href.split('?');
  if (p !== path) return false;
  const want = new URLSearchParams(q ?? '');
  for (const k of ['tab', 'mode', 'view']) {
    if ((want.get(k) ?? '') !== (sp.get(k) ?? '')) return false;
  }
  return true;
}

export function Nav({ tops }: { tops: Top[] }) {
  const path = usePathname();
  const sp = useSearchParams();
  const params = new URLSearchParams(sp.toString());
  const carry = new URLSearchParams();
  ['date', 'center'].forEach((k) => {
    const v = sp.get(k);
    if (v) carry.set(k, v);
  });
  const withCarry = (href: string) => {
    const [p, q] = href.split('?');
    const u = new URLSearchParams(q ?? '');
    carry.forEach((v, k) => u.set(k, v));
    const s = u.toString();
    return s ? `${p}?${s}` : p;
  };
  // 현재 화면이 속한 상단 메뉴 (정확히 일치 → 경로 앞부분 일치 순)
  let active = tops.findIndex((t) => t.groups.some((g) => g.items.some((i) => matches(i.href, path, params))));
  if (active < 0) active = tops.findIndex((t) => t.groups.some((g) => g.items.some((i) => i.href.split('?')[0] === path)));
  if (active < 0) active = tops.findIndex((t) => t.groups.some((g) => g.items.some((i) => path.startsWith(i.href.split('?')[0] + '/'))));
  if (active < 0) active = 0;
  const top = tops[active];

  return (
    <>
      {tops.length > 1 ? (
        <div className="topnav" role="tablist" aria-label="상단 메뉴">
          {tops.map((t, i) => (
            <Link key={t.label} role="tab" aria-selected={i === active} href={withCarry(t.groups[0].items[0].href)}>
              {t.label}
            </Link>
          ))}
        </div>
      ) : null}
      <nav aria-label="업무 메뉴">
        {top.groups.map((g) => (
          <div className="g" key={g.g}>
            <div className="gl">{g.g}</div>
            {g.items.map((i) => (
              <Link key={i.href} href={withCarry(i.href)} aria-current={matches(i.href, path, params) ? 'page' : undefined}>
                {i.label}
              </Link>
            ))}
          </div>
        ))}
      </nav>
    </>
  );
}
