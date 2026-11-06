import { redirect } from 'next/navigation';
import { requireProfile, HOME } from '@/lib/session';

export default async function Home() {
  const { p } = await requireProfile();
  redirect(HOME[p.role]);
}
