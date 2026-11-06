import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { supabase } from './supabase/server';

export function withMsg(back: string, key: 'msg' | 'err', text: string) {
  const safe = back.startsWith('/') ? back : '/';
  const u = new URL(safe, 'http://x');
  u.searchParams.delete('msg');
  u.searchParams.delete('err');
  u.searchParams.set(key, text);
  return u.pathname + u.search;
}

export const backOf = (fd: FormData) => String(fd.get('back') ?? '/');
export const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
export const ids = (fd: FormData, k = 'line') => fd.getAll(k).map(String).filter(Boolean);

/** RPC 호출 → 성공/실패 메시지를 쿼리로 달고 원래 화면으로 */
export async function rpc<T = unknown>(
  name: string,
  args: Record<string, unknown>,
  back: string,
  ok: string | ((data: T) => string),
): Promise<never> {
  const sb = await supabase();
  const { data, error } = await sb.rpc(name, args);
  if (error) redirect(withMsg(back, 'err', error.message));
  revalidatePath('/', 'layout');
  redirect(withMsg(back, 'msg', typeof ok === 'function' ? ok(data as T) : ok));
}
