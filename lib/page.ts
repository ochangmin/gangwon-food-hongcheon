import { isDate, today } from './format';

export type SP = Promise<Record<string, string | undefined>>;

/** 화면 공통 컨텍스트: 날짜, 돌아올 주소, 유지할 쿼리 */
export function ctx(path: string, sp: Record<string, string | undefined>, defaultDate = today()) {
  const date = isDate(sp.date) ? sp.date! : defaultDate;
  const keep: Record<string, string | undefined> = { center: sp.center };
  const q = new URLSearchParams();
  if (sp.center) q.set('center', sp.center);
  q.set('date', date);
  return { date, keep, back: `${path}?${q}`, msg: sp.msg, err: sp.err };
}

export function sumBy<T>(a: T[], f: (x: T) => number) {
  return a.reduce((t, x) => t + f(x), 0);
}
export function groupBy<T>(a: T[], k: (x: T) => string) {
  const m = new Map<string, T[]>();
  a.forEach((x) => {
    const key = k(x);
    if (!m.has(key)) m.set(key, []);
    m.get(key)!.push(x);
  });
  return m;
}
