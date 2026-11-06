import { notFound } from 'next/navigation';
import { requireCenter } from '@/lib/session';
import { reportOf } from '@/lib/registry';
import { type SP } from '@/lib/page';
import { won, today, addDays, weekDays, isDate } from '@/lib/format';
import { Flash, PageHead, Empty } from '@/components/ui';
import { ExportCsv } from '@/components/ExportCsv';

function range(kind: string | undefined): [string, string] {
  const t = today();
  if (kind === 'week') { const w = weekDays(t); return [w[0], w[4]]; }
  if (kind === 'year') return [`${t.slice(0, 4)}-01-01`, `${t.slice(0, 4)}-12-31`];
  if (kind === 'month') {
    const s = `${t.slice(0, 7)}-01`;
    const e = addDays(`${addDays(s, 32).slice(0, 7)}-01`, -1);
    return [s, e];
  }
  return [addDays(t, -30), t];
}

export default async function ReportScreen({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: SP }) {
  const { key } = await params;
  const rp = reportOf(key);
  if (!rp) notFound();
  const sp = await searchParams;
  const { sb, center } = await requireCenter(sp.center);
  const [df, dt] = range(rp.defaultRange);
  const from = isDate(sp.from) ? sp.from! : df;
  const to = isDate(sp.to) ? sp.to! : dt;
  const group = sp.group ?? rp.groups?.[0]?.v;
  const args: Record<string, unknown> = { p_center_id: center.id, p_from: from, p_to: to };
  if (rp.groups) args.p_group = group;
  const { data, error } = await sb.rpc(rp.rpc, args);
  const rows = (data ?? []) as Record<string, unknown>[];
  const cols = rows.length ? Object.keys(rows[0]) : [];
  const isNum = (v: unknown) => typeof v === 'number' || (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v));
  const numCols = cols.filter((c) => rows.some((r) => r[c] !== null && isNum(r[c])) && rows.every((r) => r[c] === null || isNum(r[c])) && !/코드|연도|월$/.test(c));
  const fmt = (c: string, v: unknown) => {
    if (v === null || v === undefined) return '';
    if (rp.pct?.includes(c)) return `${Number(v).toLocaleString('ko-KR')}%`;
    if (rp.money?.includes(c)) return won(v as number);
    if (numCols.includes(c)) return Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
    return String(v);
  };
  const totals = numCols.filter((c) => !rp.pct?.includes(c) && !/단가|비율/.test(c));

  return (
    <>
      <PageHead crumb={center.name} title={rp.title} umji={rp.umji} desc={rp.desc} />
      <Flash err={error?.message} />
      <form className="bar" action={`/center/r/${rp.key}`}>
        {sp.center ? <input type="hidden" name="center" value={sp.center} /> : null}
        <label className="dim" style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
          기간 <input type="date" name="from" defaultValue={from} /> ~ <input type="date" name="to" defaultValue={to} />
        </label>
        {rp.groups ? (
          <select name="group" defaultValue={group} aria-label="집계 기준">{rp.groups.map((g) => <option key={g.v} value={g.v}>{g.l}</option>)}</select>
        ) : null}
        <button className="btn">조회</button>
        <span className="sp" />
        <ExportCsv target="report" name={rp.title} />
      </form>
      <section className="panel" id="report">
        <header><h2>{rp.title}</h2><small>{from} ~ {to} · {rows.length}행</small></header>
        {!rows.length ? <Empty>조회 기간에 자료가 없습니다.</Empty> : (
          <div className="tw"><table>
            <thead><tr>{cols.map((c) => <th key={c} className={numCols.includes(c) ? 'n' : undefined}>{c}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => (
              <tr key={i}>{cols.map((c) => <td key={c} className={numCols.includes(c) ? 'n' : c === '납품학교' || c === '생산자' ? 'wrap' : undefined}>{fmt(c, r[c])}</td>)}</tr>
            ))}</tbody>
            {totals.length ? (
              <tfoot><tr>{cols.map((c, i) => (
                <td key={c} className={numCols.includes(c) ? 'n' : undefined}>
                  {i === 0 ? '합계' : totals.includes(c) ? fmt(c, rows.reduce((t, r) => t + Number(r[c] ?? 0), 0)) : ''}
                </td>))}</tr></tfoot>
            ) : null}
          </table></div>
        )}
      </section>
    </>
  );
}
