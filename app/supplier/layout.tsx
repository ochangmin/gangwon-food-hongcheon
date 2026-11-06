import { Shell } from '@/components/Shell';
import { requireProfile } from '@/lib/session';

export default async function SupplierLayout({ children }: { children: React.ReactNode }) {
  const { p } = await requireProfile(['supplier']);
  return <Shell p={p}>{children}</Shell>;
}
