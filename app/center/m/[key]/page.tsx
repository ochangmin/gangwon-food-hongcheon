import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCenter } from '@/lib/session';
import { screenOf } from '@/lib/registry';
import type { Field } from '@/lib/registry-types';
import { type SP } from '@/lib/page';
import { won, today, addDays } from '@/lib/format';
import { Flash, PageHead, Back, Empty } from '@/components/ui';
import { ExportCsv } from '@/components/ExportCsv';
import { saveRow, deleteRow } from '../actions';

type Row = Record<string, unknown> & { id: string };
type Opt = { v: string; l: string };

const optList = (f: Field): Opt[] => (f.options ?? []).map((o) => (typeof o === 'string' ? { v: o, l: o } : o));

function defaultOf(f: Field) {
  const d = f.default;
  if (d === 'today') return today();
  if (d === 'thismonth') return today().slice(0, 7);
  if (d === 'thisyear') return today().slice(0, 4);
  return d;
}

export default async function GenericScreen({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: SP }) {
  const { key } = await params;
  const sc = screenOf(key);
  if (!sc) notFound();
  const sp = await searchParams;
  const { sb, center } = await requireCenter(sp.center);

  // 참조 목록 (같은 센터)
  const refs: Record<string, Opt[]> = {};
  await Promise.all(sc.fields.filter((f) => f.type === 'ref').map(async (f) => {
    const r = f.ref!;
    const cols = ['id', r.label, r.extra, r.value].filter(Boolean).join(',');
    const { data } = await sb.from(r.table).select(cols).eq('center_id', center.id).order(r.label).limit(2000);
    refs[f.k] = ((data ?? []) as unknown as Record<string, unknown>[]).map((x) => ({
      v: String(r.value ? x[r.value] : x.id),
      l: `${x[r.label] ?? ''}${r.extra && x[r.extra] ? ` (${x[r.extra]})` : ''}`,
    }));
  }));

  // 조회
  const from = sp.from ?? (sc.dateField ? addDays(today(), -30) : undefined);
  const to = sp.to ?? (sc.dateField ? addDays(today(), 30) : undefined);
  let q = sb.from(sc.table).select('*').eq('center_id', center.id);
  for (const [k, v] of Object.entries(sc.fixed ?? {})) q = q.eq(k, v);
  for (const f of sc.fields.filter((f) => f.filter)) {
    const v = sp['f_' + f.k];
    if (!v) continue;
    q = f.type === 'text' ? q.ilike(f.k, `%${v}%`) : q.eq(f.k, v);
  }
  if (sc.dateField && from) q = q.gte(sc.dateField, from);
  if (sc.dateField && to) q = q.lte(sc.dateField, to);
  for (const o of sc.order) q = q.order(o.k, { ascending: !!o.asc });
  const { data, error } = await q.limit(1000);
  const rows = (data ?? []) as Row[];
  const editing = sp.edit ? rows.find((r) => r.id === sp.edit) : undefined;

  const qs = new URLSearchParams();
  Object.entries(sp).forEach(([k, v]) => { if (v && !['msg', 'err', 'edit'].includes(k)) qs.set(k, v); });
  const base = `/center/m/${sc.key}`;
  const back = `${base}${qs.toString() ? `?${qs}` : ''}`;
  const listFields = sc.fields.filter((f) => f.list !== false);
  const formFields = sc.fields.filter((f) => f.form !== false && f.type !== 'datetime');

  const show = (f: Field, v: unknown) => {
    if (v === null || v === undefined || v === '') return <span className="dim">—</span>;
    if (f.type === 'bool') return v ? '✓' : '';
    if (f.type === 'money') return won(v as number);
    if (f.type === 'ref') return refs[f.k]?.find((o) => o.v === String(v))?.l ?? <span className="dim">삭제됨</span>;
    if (f.type === 'select') return optList(f).find((o) => o.v === String(v))?.l ?? String(v);
    if (f.type === 'image') return <img src={String(v)} alt="" style={{ height: 36 }} />;
    if (f.type === 'datetime') return new Date(String(v)).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    return String(v);
  };
  const input = (f: Field) => {
    const cur = editing ? editing[f.k] : defaultOf(f);
    const dv = cur === null || cur === undefined ? '' : String(cur);
    const common = { name: f.k, id: `fld-${f.k}`, required: f.required && f.type !== 'image' };
    switch (f.type) {
      case 'bool': return <input type="checkbox" name={f.k} id={`fld-${f.k}`} defaultChecked={!!cur} />;
      case 'select': return <select {...common} defaultValue={dv}><option value="">선택</option>{optList(f).map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}</select>;
      case 'ref': return <select {...common} defaultValue={dv}><option value="">선택</option>{(refs[f.k] ?? []).map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}</select>;
      case 'textarea': return <textarea {...common} defaultValue={dv} style={{ minHeight: 80, fontFamily: 'inherit', fontSize: 13 }} />;
      case 'date': return <input type="date" {...common} defaultValue={dv.slice(0, 10)} />;
      case 'month': return <input type="month" {...common} defaultValue={dv} />;
      case 'year': return <input type="number" {...common} min={2000} max={2100} defaultValue={dv} />;
      case 'number': case 'money': return <input type="number" step="any" {...common} defaultValue={dv} />;
      case 'image': return <input type="file" accept="image/png,image/jpeg,image/gif" name={f.k} id={`fld-${f.k}`} />;
      default: return <input type="text" {...common} defaultValue={dv} />;
    }
  };

  return (
    <>
      <PageHead crumb={center.name} title={sc.title} umji={sc.umji} desc={sc.desc} />
      <Flash msg={sp.msg} err={sp.err ?? error?.message} />
      <form className="bar" action={base}>
        {sp.center ? <input type="hidden" name="center" value={sp.center} /> : null}
        {sc.fields.filter((f) => f.filter).map((f) => (
          <label key={f.k} className="dim" style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
            {f.label}
            {f.type === 'ref' || f.type === 'select'
              ? <select name={'f_' + f.k} defaultValue={sp['f_' + f.k] ?? ''}><option value="">전체</option>{(f.type === 'ref' ? refs[f.k] ?? [] : optList(f)).map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}</select>
              : <input type={f.type === 'month' ? 'month' : f.type === 'year' ? 'number' : 'text'} name={'f_' + f.k} defaultValue={sp['f_' + f.k] ?? ''} style={{ width: f.type === 'year' ? 90 : 150 }} />}
          </label>
        ))}
        {sc.dateField ? (
          <label className="dim" style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
            기간 <input type="date" name="from" defaultValue={from} /> ~ <input type="date" name="to" defaultValue={to} />
          </label>
        ) : null}
        <button className="btn">조회</button>
        <span className="sp" />
        <ExportCsv target="grid" name={sc.title} />
      </form>

      <section className="panel" id="grid">
        <header><h2>{sc.title} 목록</h2><small>{rows.length}건{rows.length >= 1000 ? ' (최대 1,000건)' : ''}</small></header>
        {!rows.length ? <Empty>조회된 자료가 없습니다.{!sc.readonly && !sc.noCreate ? ' 아래에서 등록하세요.' : ''}</Empty> : (
          <div className="tw"><table>
            <thead><tr>{listFields.map((f) => <th key={f.k} className={f.type === 'money' || f.type === 'number' ? 'n' : undefined}>{f.label}</th>)}{!sc.readonly ? <th className="noexport" /> : null}</tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} style={editing?.id === r.id ? { background: 'var(--accent-soft)' } : undefined}>
                {listFields.map((f) => <td key={f.k} className={f.type === 'money' || f.type === 'number' ? 'n' : f.type === 'textarea' ? 'wrap' : undefined}>{show(f, r[f.k])}</td>)}
                {!sc.readonly ? <td className="noexport"><Link href={`${back}${back.includes('?') ? '&' : '?'}edit=${r.id}#edit`}>수정</Link></td> : null}
              </tr>))}</tbody>
          </table></div>
        )}
      </section>

      {!sc.readonly && (editing || !sc.noCreate) ? (
        <section className="panel pad" id="edit">
          <h2 style={{ marginBottom: 10 }}>{editing ? '수정' : '등록'}</h2>
          <form className="form" action={saveRow} encType="multipart/form-data">
            <Back value={back} />
            <input type="hidden" name="_screen" value={sc.key} />
            <input type="hidden" name="_center" value={center.id} />
            {editing ? <input type="hidden" name="_id" value={editing.id} /> : null}
            {formFields.map((f) => (
              <label key={f.k} htmlFor={`fld-${f.k}`} className={f.type === 'textarea' ? 'wide' : undefined}>
                {f.label}{f.required ? ' *' : ''}
                {input(f)}
              </label>
            ))}
            <div className="bar" style={{ margin: 0 }}>
              <button className="btn pri">{editing ? '저장' : '등록'}</button>
              {editing ? <Link className="btn" href={back}>취소</Link> : null}
            </div>
          </form>
          {editing && !sc.noCreate ? (
            <form action={deleteRow} className="bar" style={{ marginTop: 12 }}>
              <Back value={back} /><input type="hidden" name="_screen" value={sc.key} /><input type="hidden" name="_id" value={editing.id} />
              <label className="dim" style={{ fontSize: 13 }}><input type="checkbox" name="_confirm" /> 이 자료를 삭제합니다</label>
              <button className="btn dan">삭제</button>
            </form>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
