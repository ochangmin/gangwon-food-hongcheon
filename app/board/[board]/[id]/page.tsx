import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireProfile } from '@/lib/session';
import { type SP } from '@/lib/page';
import { Flash, Back } from '@/components/ui';
import { deletePost } from '../../actions';

export default async function Post({ params, searchParams }: { params: Promise<{ board: string; id: string }>; searchParams: SP }) {
  const { board, id } = await params;
  const sp = await searchParams;
  const { sb, p } = await requireProfile();
  await sb.rpc('post_view', { p_id: id });
  const { data: x } = await sb.from('posts').select('*').eq('id', id).single();
  if (!x) notFound();
  const canDelete = x.created_by === p.id || p.role === 'province_admin' || (p.role === 'center_admin' && x.center_id === p.center_id);
  return (
    <>
      <div className="bar"><Link className="btn" href={`/board/${board}`}>‹ 목록</Link></div>
      <Flash msg={sp.msg} err={sp.err} />
      <article className="panel pad">
        <h1 style={{ fontSize: 20 }}>{x.title}</h1>
        <p className="dim" style={{ fontSize: 13 }}>{x.author_name} · {new Date(x.created_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} · 조회 {x.views}</p>
        <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7, maxWidth: '75ch' }}>{x.body}</div>
      </article>
      {canDelete ? (
        <form action={deletePost} className="bar">
          <Back value={`/board/${board}/${id}`} /><input type="hidden" name="list" value={`/board/${board}`} /><input type="hidden" name="id" value={id} />
          <button className="btn dan">삭제</button>
        </form>
      ) : null}
    </>
  );
}
