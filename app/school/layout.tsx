import { Shell } from '@/components/Shell';
import { requireProfile } from '@/lib/session';

export default async function SchoolLayout({ children }: { children: React.ReactNode }) {
  const { p } = await requireProfile(['school']);
  return (
    <Shell p={p} groups={[
      { g: '주문', items: [{ href: '/school', label: '주간 주문' }] },
      { g: '납품', items: [{ href: '/school/deliveries', label: '납품·검수' }, { href: '/school/claims', label: '클레임' }] },
    ]}>{children}</Shell>
  );
}
