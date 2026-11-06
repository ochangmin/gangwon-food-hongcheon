'use server';
import { redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase/server';

export async function signIn(fd: FormData) {
  const sb = await supabase();
  const { error } = await sb.auth.signInWithPassword({
    email: String(fd.get('email') ?? ''),
    password: String(fd.get('password') ?? ''),
  });
  if (error) redirect('/login?err=' + encodeURIComponent('이메일 또는 비밀번호가 맞지 않습니다'));
  redirect('/');
}

export async function signOut() {
  const sb = await supabase();
  await sb.auth.signOut();
  redirect('/login');
}
