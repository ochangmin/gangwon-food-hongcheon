import { Shell } from '@/components/Shell';
import { requireProfile } from '@/lib/session';

export default async function BoardLayout({ children }: { children: React.ReactNode }) {
  const { p } = await requireProfile();
  return <Shell p={p}>{children}</Shell>;
}
