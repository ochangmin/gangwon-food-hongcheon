// 데모 계정 생성 (seed.sql 적용 후 1회 실행)
// 사용: NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... DEMO_PASSWORD=... node scripts/create-demo-users.mjs
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.DEMO_PASSWORD;
if (!url || !key || !password || password.length < 10) {
  console.error('NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DEMO_PASSWORD(10자 이상)를 설정하세요');
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });
const HC = '11111111-0000-0000-0000-000000000001';
const CC = '11111111-0000-0000-0000-000000000002';
const idOf = async (t, center, code) => (await sb.from(t).select('id').eq('center_id', center).eq('code', code).single()).data?.id;

const users = [
  { email: 'province@demo.eum', name: '도 급식담당', role: 'province_admin' },
  { email: 'hongcheon@demo.eum', name: '홍천센터 관리자', role: 'center_admin', center_id: HC },
  { email: 'chuncheon@demo.eum', name: '춘천센터 관리자', role: 'center_admin', center_id: CC },
  { email: 's101@demo.eum', name: '홍천초 영양교사', role: 'school', center_id: HC, school_id: await idOf('schools', HC, 'S101') },
  { email: 'p01@demo.eum', name: '내면 고랭지작목반', role: 'supplier', center_id: HC, supplier_id: await idOf('suppliers', HC, 'P01') },
];

for (const u of users) {
  const { data, error } = await sb.auth.admin.createUser({ email: u.email, password, email_confirm: true });
  if (error) { console.log('건너뜀', u.email, error.message); continue; }
  const { email, ...profile } = u;
  const { error: e2 } = await sb.from('profiles').insert({ id: data.user.id, ...profile });
  console.log(e2 ? `실패 ${email}: ${e2.message}` : `생성 ${email} (${u.role})`);
}
