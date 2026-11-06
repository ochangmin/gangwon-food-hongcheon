import { Shell } from '@/components/Shell';
import { requireProfile } from '@/lib/session';

export default async function SchoolLayout({ children }: { children: React.ReactNode }) {
  const { p } = await requireProfile(['school']);
  return <Shell p={p}>{children}</Shell>;
}
