/**
 * umji 화면에서 실행하는 수집 스크립트 (북마클릿/콘솔용) 생성.
 * umji는 넥사크로 앱이라 화면에 조회된 데이터셋이 브라우저 메모리에 있음 → 그 행을 그대로 이음 API로 전송.
 * 출고처리(SA020240) 화면에서 기간 조회 후 실행하면 dsInv(출고 라인)를 보냄.
 */
export function collectorSource(endpoint: string, centerCode: string) {
  return `(async () => {
  const ENDPOINT = ${JSON.stringify(endpoint)};
  const CENTER = ${JSON.stringify(centerCode)};
  const DATASET_BY_FORM = { SA020240: ['dsInv', 'shipments'], SA020230: ['dsInv', 'shipments'] };
  const app = window.nexacro && nexacro.getApplication && nexacro.getApplication();
  if (!app) return alert('umji 화면에서 실행하세요.');
  const forms = [];
  (function walk(f, d) {
    if (!f || d > 6) return;
    if (f.form) walk(f.form, d + 1);
    if (f.objects) forms.push(f);
    const cs = f.components || f.frames || f.all;
    if (cs) for (let i = 0; i < cs.length; i++) walk(cs[i], d + 1);
  })(app.mainframe, 0);
  const target = forms.find((f) => DATASET_BY_FORM[f.name]);
  if (!target) return alert('출고처리(SA020240) 화면을 열고 조회한 뒤 실행하세요.');
  const [dsName, dataset] = DATASET_BY_FORM[target.name];
  const ds = target.objects[dsName] || target[dsName];
  if (!ds || !ds.getRowCount()) return alert('조회된 데이터가 없습니다. 기간을 정해 조회한 뒤 실행하세요.');
  const cols = []; for (let j = 0; j < ds.getColCount(); j++) cols.push(ds.getColID(j));
  const rows = [];
  for (let i = 0; i < ds.getRowCount(); i++) { const r = {}; cols.forEach((c) => { const v = ds.getColumn(i, c); if (v !== undefined && v !== null && v !== '') r[c] = String(v); }); rows.push(r); }
  let token = sessionStorage.getItem('eum_token');
  if (!token) { token = prompt('이음 수집 토큰을 입력하세요 (센터 관리자에게 받은 값)'); if (!token) return; sessionStorage.setItem('eum_token', token); }
  const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ center: CENTER, dataset, rows }) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) { if (res.status === 401) sessionStorage.removeItem('eum_token'); return alert('전송 실패: ' + (out.error || res.status)); }
  alert('이음 전송 완료\\n적재 ' + out.loaded + '건 · 반영 ' + out.mapped + '건' + (out.errors ? ' · 오류 ' + out.errors + '건' : ''));
})();`;
}
