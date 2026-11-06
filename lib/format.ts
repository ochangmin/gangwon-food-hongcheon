export const STATUS: Record<string, string> = {
  draft: '작성중',
  submitted: '주문제출',
  confirmed: '주문확정',
  received: '입고완료',
  shipped: '출고확정',
  delivered: '배송완료',
  canceled: '취소',
};
export const PO_STATUS: Record<string, string> = { issued: '발주', acknowledged: '업체확인', received: '입고완료', canceled: '취소' };
export const STORAGE: Record<string, string> = { ambient: '상온', chilled: '냉장', frozen: '냉동' };
export const CLAIM_STATUS: Record<string, string> = { open: '접수', in_progress: '처리중', closed: '완료' };

export const won = (n: number | string | null | undefined) => Math.round(Number(n ?? 0)).toLocaleString('ko-KR');
export const qty = (n: number | string | null | undefined) => (Math.round(Number(n ?? 0) * 100) / 100).toLocaleString('ko-KR');

/** 한국 시간 기준 오늘 YYYY-MM-DD */
export function today(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}
export function addDays(d: string, n: number): string {
  const x = new Date(d + 'T00:00:00Z');
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}
/** 해당 주 월~금 */
export function weekDays(d: string): string[] {
  const x = new Date(d + 'T00:00:00Z');
  const dow = (x.getUTCDay() + 6) % 7;
  const mon = addDays(d, -dow);
  return [0, 1, 2, 3, 4].map((i) => addDays(mon, i));
}
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
export function dlabel(d: string): string {
  const x = new Date(d + 'T00:00:00Z');
  return `${d.slice(5, 7)}.${d.slice(8, 10)} (${DOW[x.getUTCDay()]})`;
}
export const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
