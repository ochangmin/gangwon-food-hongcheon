import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireProfile } from '@/lib/session';
import { type SP } from '@/lib/page';
import { Flash, PageHead, Back, Empty } from '@/components/ui';
import { writePost } from '../actions';

const BOARDS: Record<string, { name: '공지' | '자유'; title: string; umji: string; desc: string }> = {
  notice: { name: '공지', title: '공지사항', umji: 'FC040010', desc: '도와 센터의 공지입니다. 도 전체 공지는 모든 센터·학교·업체에 보입니다.' },
  free: { name: '자유', title: '자유게시판', umji: 'FC040020', desc: '같은 센터의 학교·공급업체·센터가 함께 쓰는 게시판입니다.' },
};

export default async function Board({ params, searchParams }: { params: Promise<{ board: string }>; searchParams: SP }) {
  const { board } = await params;
  const b = BOARDS[board];
  if (!b) notFound();
  const sp = await searchParams;
  const { sb, p } = await requireProfile();
  const { data } = await sb.from('posts').select('id,title,author_name,created_at,views,pinned,center_id').eq('board', b.name)
    .order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(200);
  const posts = data ?? [];
  const canWrite = b.name === '자유' ? !!p.center_id : p.role === 'province_admin' || p.role === 'center_admin';
  return (
    <>
      <PageHead crumb="커뮤니티" title={b.title} umji={b.umji} desc={b.desc} />
      <Flash msg={sp.msg} err={sp.err} />
      <section className="panel">
        {!posts.length ? <Empty>게시글이 없습니다.</Empty> : (
          <div className="tw"><table>
            <thead><tr><th>제목</th><th>작성자</th><th>작성일자</th><th className="n">조회수</th></tr></thead>
            <tbody>{posts.map((x) => (
              <tr key={x.id}>
                <td>{x.pinned ? <span className="pill s-open" style={{ marginRight: 6 }}>공지</span> : null}{x.center_id === null ? <span className="pill s-submitted" style={{ marginRight: 6 }}>도 전체</span> : null}
                  <Link href={`/board/${board}/${x.id}`}>{x.title}</Link></td>
                <td>{x.author_name}</td><td>{x.created_at.slice(0, 10)}</td><td className="n">{x.views}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </section>
      {canWrite ? (
        <form className="panel pad form" action={writePost}>
          <Back value={`/board/${board}`} /><input type="hidden" name="board" value={b.name} />
          <h2 className="wide">글쓰기</h2>
          <label className="wide">제목<input type="text" name="title" required maxLength={200} /></label>
          <label className="wide">내용<textarea name="body" required style={{ fontFamily: 'inherit', fontSize: 14, minHeight: 160 }} /></label>
          {b.name === '공지' ? <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><input type="checkbox" name="pinned" /> 상단 고정</label> : null}
          <div><button className="btn pri">등록</button></div>
        </form>
      ) : null}
    </>
  );
}
