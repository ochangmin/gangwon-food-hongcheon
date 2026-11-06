import { redirect } from 'next/navigation';
import { supabase } from './supabase/server';

export type Role = 'province_admin' | 'center_admin' | 'school' | 'supplier';

export type Profile = {
  id: string;
  name: string;
  role: Role;
  center_id: string | null;
  school_id: string | null;
  supplier_id: string | null;
  centers: { name: string; code: string; sigungu: string } | null;
  schools: { name: string; code: string } | null;
  suppliers: { name: string; code: string } | null;
};

export const HOME: Record<Role, string> = {
  province_admin: '/province',
  center_admin: '/center',
  school: '/school',
  supplier: '/supplier',
};

export async function requireProfile(roles?: Role[]) {
  const sb = await supabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');
  const { data } = await sb
    .from('profiles')
    .select('*, centers(name,code,sigungu), schools(name,code), suppliers(name,code)')
    .eq('id', user.id)
    .single();
  const p = data as Profile | null;
  if (!p) redirect('/login?err=' + encodeURIComponent('계정에 연결된 역할이 없습니다. 센터 관리자에게 문의하세요'));
  if (roles && !roles.includes(p.role)) redirect(HOME[p.role]);
  return { sb, p };
}

/** 센터 화면의 대상 센터: 센터 관리자는 자기 센터, 도 관리자는 ?center= 로 선택 */
export async function requireCenter(center?: string) {
  const { sb, p } = await requireProfile(['center_admin', 'province_admin']);
  let centerId = p.center_id;
  if (p.role === 'province_admin') {
    if (center) centerId = center;
    if (!centerId) {
      const { data } = await sb.from('centers').select('id').order('sigungu').limit(1).single();
      centerId = data?.id ?? null;
    }
  }
  if (!centerId) redirect('/province');
  const { data: c } = await sb.from('centers').select('id,code,name,sigungu').eq('id', centerId).single();
  return { sb, p, center: c as { id: string; code: string; name: string; sigungu: string } };
}
