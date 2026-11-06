import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

/** 로그인 사용자 권한(RLS)으로 동작하는 서버 클라이언트 */
export async function supabase() {
  const store = await cookies();
  return createServerClient(URL, ANON, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // 서버 컴포넌트 렌더 중에는 쿠키를 쓸 수 없음 (미들웨어가 갱신)
        }
      },
    },
  });
}

/** service_role 클라이언트: 계정 생성·umji 수집 API 전용. RLS를 우회하므로 호출부에서 권한을 확인할 것 */
export function adminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았습니다');
  return createClient(URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
