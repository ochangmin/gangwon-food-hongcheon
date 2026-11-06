'use server';
import { redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase/server';

export async function signIn(fd: FormData) {
  const sb = await supabase();
  const { error } = await sb.auth.signInWithPassword({
    email: String(fd.get('email') ?? ''),
    password: String(fd.get('password') ?? ''),
  });
  if (error) {
    const m = /invalid login credentials/i.test(error.message)
      ? '이메일 또는 비밀번호가 맞지 않습니다'
      : /fetch failed|ECONNREFUSED/i.test(error.message)
        ? '로그인 서버(Supabase)에 연결할 수 없습니다. Docker Desktop과 start-local.bat 실행 상태를 확인하세요'
        : '로그인 실패: ' + error.message;
    redirect('/login?err=' + encodeURIComponent(m));
  }
  redirect('/');
}

export async function signOut() {
  const sb = await supabase();
  await sb.auth.signOut();
  redirect('/login');
}
