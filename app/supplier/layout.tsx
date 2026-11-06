import { Shell } from '@/components/Shell';
import { requireProfile } from '@/lib/session';

export default async function SupplierLayout({ children }: { children: React.ReactNode }) {
  const { p } = await requireProfile(['supplier']);
  return <Shell p={p} groups={[{ g: '발주', items: [{ href: '/supplier', label: '발주 확인' }, { href: '/supplier/lots', label: '입고·로트 이력' }] }]}>{children}</Shell>;
}
