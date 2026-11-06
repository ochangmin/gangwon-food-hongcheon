'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { supabase } from '@/lib/supabase/server';
import { screenOf } from '@/lib/registry';
import { backOf, str, withMsg } from '@/lib/act';
import type { Field } from '@/lib/registry-types';

async function value(f: Field, fd: FormData): Promise<unknown> {
  if (f.type === 'bool') return fd.get(f.k) === 'on';
  if (f.type === 'image') {
    const file = fd.get(f.k);
    if (!(file instanceof File) || !file.size) return undefined; // 새 파일이 없으면 기존 값 유지
    if (file.size > 300_000) throw new Error('이미지는 300KB 이하로 올려주세요');
    const buf = Buffer.from(await file.arrayBuffer());
    return `data:${file.type || 'image/png'};base64,${buf.toString('base64')}`;
  }
  const raw = str(fd, f.k);
  if (raw === '') return null;
  if (f.type === 'number' || f.type === 'money' || f.type === 'year') {
    const n = Number(raw.replace(/,/g, ''));
    if (Number.isNaN(n)) throw new Error(`${f.label}에 숫자를 입력하세요`);
    return n;
  }
  return raw;
}

export async function saveRow(fd: FormData) {
  const back = backOf(fd);
  const sc = screenOf(str(fd, '_screen'));
  if (!sc || sc.readonly) redirect(withMsg(back, 'err', '저장할 수 없는 화면입니다'));
  const id = str(fd, '_id');
  if (!id && sc.noCreate) redirect(withMsg(back, 'err', '이 화면에서는 새로 등록할 수 없습니다'));
  const row: Record<string, unknown> = {};
  try {
    for (const f of sc.fields) {
      if (f.form === false || f.type === 'datetime') continue;
      const v = await value(f, fd);
      if (v === undefined) continue;
      if (f.required && (v === null || v === '')) throw new Error(`${f.label}을(를) 입력하세요`);
      row[f.k] = v;
    }
  } catch (e) {
    redirect(withMsg(back, 'err', (e as Error).message));
  }
  Object.assign(row, sc.fixed ?? {});
  const sb = await supabase();
  const { error } = id
    ? await sb.from(sc.table).update(row).eq('id', id)
    : await sb.from(sc.table).insert({ ...row, center_id: str(fd, '_center') });
  if (error) {
    const msg = error.code === '23505' ? '같은 값이 이미 등록되어 있습니다' : error.code === '23503' ? '다른 자료에서 쓰고 있어 처리할 수 없습니다' : error.message;
    redirect(withMsg(back, 'err', msg));
  }
  revalidatePath('/center/m/' + sc.key);
  redirect(withMsg(back.replace(/([?&])edit=[^&]*&?/, '$1'), 'msg', id ? '수정했습니다' : '등록했습니다'));
}

export async function deleteRow(fd: FormData) {
  const back = backOf(fd);
  const sc = screenOf(str(fd, '_screen'));
  if (!sc || sc.readonly || sc.noCreate) redirect(withMsg(back, 'err', '삭제할 수 없는 화면입니다'));
  if (fd.get('_confirm') !== 'on') redirect(withMsg(back, 'err', '삭제하려면 확인란을 체크하세요'));
  const sb = await supabase();
  const { error } = await sb.from(sc.table).delete().eq('id', str(fd, '_id'));
  if (error) redirect(withMsg(back, 'err', error.code === '23503' ? '다른 자료에서 쓰고 있어 삭제할 수 없습니다' : error.message));
  revalidatePath('/center/m/' + sc.key);
  redirect(withMsg(back.replace(/([?&])edit=[^&]*&?/, '$1'), 'msg', '삭제했습니다'));
}
