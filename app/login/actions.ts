'use server';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
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
  await logAccess('login');
  redirect('/');
}

export async function signOut() {
  await logAccess('logout');
  const sb = await supabase();
  await sb.auth.signOut();
  redirect('/login');
}

/** 접속 로그 (실패해도 로그인은 계속) */
async function logAccess(action: string) {
  try {
    const sb = await supabase();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return;
    const { data: p } = await sb.from('profiles').select('role,center_id').eq('id', user.id).single();
    const h = await headers();
    await sb.from('access_logs').insert({
      user_id: user.id, email: user.email, role: p?.role ?? null, center_id: p?.center_id ?? null, action,
      ip: (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || '127.0.0.1', user_agent: h.get('user-agent'),
    });
  } catch {
    // 무시
  }
}
