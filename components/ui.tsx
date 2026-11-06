import Link from 'next/link';
import { STATUS, PO_STATUS, addDays, dlabel } from '@/lib/format';

export function Pill({ s, kind = 'line' }: { s: string; kind?: 'line' | 'po' }) {
  const label = kind === 'po' ? PO_STATUS[s] : STATUS[s];
  return <span className={`pill s-${s}`}>{label ?? s}</span>;
}

export function Flash({ msg, err }: { msg?: string; err?: string }) {
  if (!msg && !err) return null;
  return (
    <p role="status" className={err ? 'flash bad' : 'flash'}>
      {err ?? msg}
    </p>
  );
}

/** 날짜 이동 바 (GET 폼). 다른 쿼리는 hidden으로 유지 */
export function DateBar({ path, date, keep = {}, step = 1 }: { path: string; date: string; keep?: Record<string, string | undefined>; step?: number }) {
  const q = (d: string) => {
    const u = new URLSearchParams();
    Object.entries(keep).forEach(([k, v]) => v && u.set(k, v));
    u.set('date', d);
    return `${path}?${u}`;
  };
  return (
    <form className="datebar" action={path}>
      {Object.entries(keep).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <Link className="btn" href={q(addDays(date, -step))} aria-label="이전">‹</Link>
      <label>
        <span className="sr">납품일</span>
        <input type="date" name="date" defaultValue={date} />
      </label>
      <Link className="btn" href={q(addDays(date, step))} aria-label="다음">›</Link>
      <button className="btn">조회</button>
      <span className="dim">{dlabel(date)}</span>
    </form>
  );
}

export function PageHead({ crumb, title, desc, umji, children }: { crumb: string; title: string; desc?: string; umji?: string; children?: React.ReactNode }) {
  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb">{crumb}</div>
          <h1>{title}</h1>
        </div>
        {umji ? <span className="umji" title="대응하는 umji 프로그램 ID">umji {umji}</span> : null}
      </div>
      {desc ? <p className="lede">{desc}</p> : null}
      {children}
    </>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function Back({ value }: { value: string }) {
  return <input type="hidden" name="back" value={value} />;
}
