'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { supabase } from '@/lib/supabase/server';
import { requireProfile } from '@/lib/session';
import { backOf, str, withMsg } from '@/lib/act';

export async function writePost(fd: FormData) {
  const back = backOf(fd);
  const { sb, p } = await requireProfile();
  const board = str(fd, 'board') === '공지' ? '공지' : '자유';
  const all = p.role === 'province_admin';
  const { error } = await sb.from('posts').insert({
    board, title: str(fd, 'title'), body: str(fd, 'body'), author_name: p.name, created_by: p.id,
    center_id: all ? null : p.center_id, pinned: fd.get('pinned') === 'on',
  });
  if (error) redirect(withMsg(back, 'err', error.code === '42501' ? '이 게시판에 글을 쓸 권한이 없습니다' : error.message));
  revalidatePath('/board');
  redirect(withMsg(back, 'msg', '등록했습니다'));
}

export async function deletePost(fd: FormData) {
  const sb = await supabase();
  const { error } = await sb.from('posts').delete().eq('id', str(fd, 'id'));
  if (error) redirect(withMsg(backOf(fd), 'err', error.message));
  revalidatePath('/board');
  redirect(withMsg(str(fd, 'list'), 'msg', '삭제했습니다'));
}
