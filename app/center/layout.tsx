import { Shell } from '@/components/Shell';
import { requireProfile } from '@/lib/session';
import type { NavGroup } from '@/components/Nav';

export default async function CenterLayout({ children }: { children: React.ReactNode }) {
  const { p } = await requireProfile(['center_admin', 'province_admin']);
  const groups: NavGroup[] = [
    { g: '현황', items: [{ href: '/center', label: '오늘 현황' }] },
    { g: '주문·발주', items: [{ href: '/center/orders', label: '주문확정' }, { href: '/center/purchase', label: '발주·입고' }] },
    { g: '출고·배송', items: [{ href: '/center/shipping', label: '출고·거래명세' }, { href: '/center/delivery', label: '배송 운행' }] },
    { g: '품질', items: [{ href: '/center/lots', label: '로트 추적' }, { href: '/center/claims', label: '클레임' }] },
    { g: '기준정보', items: [{ href: '/center/masters', label: '기준정보' }, { href: '/center/users', label: '계정 관리' }] },
    { g: '연계', items: [{ href: '/center/umji', label: 'umji 연계' }] },
  ];
  if (p.role === 'province_admin') groups.unshift({ g: '도', items: [{ href: '/province', label: '도 통합 현황' }] });
  return <Shell p={p} groups={groups}>{children}</Shell>;
}
