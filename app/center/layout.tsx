import { Shell } from '@/components/Shell';
import { requireProfile } from '@/lib/session';

export default async function CenterLayout({ children }: { children: React.ReactNode }) {
  const { p } = await requireProfile(['center_admin', 'province_admin']);
  return <Shell p={p}>{children}</Shell>;
}
