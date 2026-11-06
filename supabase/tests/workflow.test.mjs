// DB 통합 테스트: PGlite(Postgres WASM)에 마이그레이션·시드를 적용하고 역할별 권한과 업무 흐름을 검증
// 실행: node supabase/tests/workflow.test.mjs
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// PGURL이 있으면 실제 Postgres, 없으면 PGlite(내장)로 실행
let db;
if (process.env.PGURL) {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: process.env.PGURL });
  await client.connect();
  await client.query('drop schema if exists public cascade; drop schema if exists app cascade; drop schema if exists auth cascade; create schema public;');
  await client.query(`do $$ begin if exists (select 1 from pg_roles where rolname='authenticated') then execute 'drop owned by authenticated'; execute 'drop role authenticated'; end if;
    if exists (select 1 from pg_roles where rolname='anon') then execute 'drop owned by anon'; execute 'drop role anon'; end if; end $$;`);
  db = { exec: (s) => client.query(s), query: (s, p) => client.query(s, p), close: () => client.end() };
} else {
  db = new PGlite();
}
const REAL = !!process.env.PGURL;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };
async function throws(fn, re, m) {
  try { await fn(); ok(false, m + ' (오류가 나야 함)'); }
  catch (e) { ok(re.test(e.message), m + ' → ' + e.message.split('\n')[0]); }
}

// Supabase auth 스텁
await db.exec(`
  create role authenticated nologin; create role anon nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
`);
for (const f of readdirSync(join(root, 'migrations')).sort()) {
  // PGlite에는 pgcrypto가 없음 (gen_random_uuid는 PG13+ 내장)
  const sql = readFileSync(join(root, 'migrations', f), 'utf8').replace(/create extension if not exists pgcrypto;/, REAL ? 'create extension if not exists pgcrypto;' : '');
  try { await db.exec(sql); } catch (e) { console.error('마이그레이션 실패', f, e.message, e.position); process.exit(1); }
}
await db.exec(readFileSync(join(root, 'seed.sql'), 'utf8'));

const HC = '11111111-0000-0000-0000-000000000001', CC = '11111111-0000-0000-0000-000000000002';
const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const id = async (t, code, center = HC) => (await one(`select id from public.${t} where center_id=$1 and code=$2`, [center, code])).id;
const S101 = await id('schools', 'S101'), S102 = await id('schools', 'S102'), S201 = await id('schools', 'S201', CC);
const P01 = await id('suppliers', 'P01'), P03 = await id('suppliers', 'P03');
const I01 = await id('items', 'I01'), I02 = await id('items', 'I02'), I07 = await id('items', 'I07'), I10 = await id('items', 'I10');
const CCI01 = await id('items', 'I01', CC);

const U = {
  prov: 'aaaaaaaa-0000-0000-0000-000000000001', hc: 'aaaaaaaa-0000-0000-0000-000000000002', cc: 'aaaaaaaa-0000-0000-0000-000000000003',
  s101: 'aaaaaaaa-0000-0000-0000-000000000004', p01: 'aaaaaaaa-0000-0000-0000-000000000005', s201: 'aaaaaaaa-0000-0000-0000-000000000006',
};
await db.exec(`insert into auth.users(id) values ${Object.values(U).map(u => `('${u}')`).join(',')}`);
await db.query(`insert into public.profiles(id,name,role,center_id,school_id,supplier_id) values
  ($1,'도 담당','province_admin',null,null,null), ($2,'홍천센터','center_admin',$7,null,null), ($3,'춘천센터','center_admin',$8,null,null),
  ($4,'홍천초 영양교사','school',$7,$9,null), ($5,'내면작목반','supplier',$7,null,$10), ($6,'춘천초 영양교사','school',$8,$11,null)`,
  [U.prov, U.hc, U.cc, U.s101, U.p01, U.s201, HC, CC, S101, P01, S201]);

async function as(user, fn) {
  await db.exec(`set role authenticated`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user]);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false)`); }
}
const D = '2026-11-16';

console.log('\n[1] 학교 주문 작성·제출');
await as(U.s101, async () => {
  const r = await one(`select public.save_order($1,$2,$3::jsonb,false) r`, [S101, D, JSON.stringify([{ item_id: I01, qty: 30 }, { item_id: I07, qty: 18.5 }, { item_id: I10, qty: 2 }])]);
  ok(r.r.saved === 3, '작성중 3건 저장');
  const l = await one(`select sale_price from public.order_lines where school_id=$1 and item_id=$2`, [S101, I01]);
  ok(Number(l.sale_price) === 2800, '납품일 기준 단가 자동 적용 (2,800원)');
  await db.query(`update public.order_lines set sale_price = 1 where school_id=$1 and item_id=$2`, [S101, I01]);
  ok(Number((await one(`select sale_price from public.order_lines where school_id=$1 and item_id=$2`, [S101, I01])).sale_price) === 2800, '학교가 단가를 바꿔도 등록 단가로 되돌아감');
  await db.query(`select public.save_order($1,$2,$3::jsonb,true)`, [S101, D, JSON.stringify([])]);
  ok((await one(`select count(*)::int n from public.order_lines where school_id=$1 and status='submitted'`, [S101])).n === 3, '제출 → submitted 3건');
  await throws(() => db.query(`select public.save_order($1,$2,'[]'::jsonb)`, [S102, D]), /권한/, '다른 학교 주문 불가');
  await throws(() => db.query(`select public.save_order($1,$2,$3::jsonb)`, [S101, D, JSON.stringify([{ item_id: CCI01, qty: 1 }])]), /등록되지 않은 상품/, '다른 센터 상품 주문 불가');
  await throws(() => db.query(`select public.save_order($1,'2026-01-05','[]'::jsonb)`, [S101]), /수정할 수 없습니다/, '지난 납품일 수정 불가');
  await throws(() => db.query(`update public.order_lines set status='confirmed' where school_id=$1`, [S101]), /./, '학교가 직접 확정 상태로 변경 불가');
  ok((await one(`select count(*)::int n from public.schools`)).n === 1, '학교 계정은 자기 학교만 조회');
});
await as(U.hc, async () => {
  await db.query(`select public.save_order($1,$2,$3::jsonb,true)`, [S102, D, JSON.stringify([{ item_id: I01, qty: 20 }, { item_id: I02, qty: 15 }])]);
});

console.log('\n[2] 센터 권한 분리');
await as(U.cc, async () => {
  ok((await one(`select count(*)::int n from public.order_lines`)).n === 0, '춘천센터는 홍천 주문을 볼 수 없음');
  await throws(() => db.query(`select public.confirm_orders($1,$2)`, [HC, D]), /권한/, '춘천센터가 홍천 주문 확정 불가');
});
await as(U.p01, async () => {
  ok((await one(`select count(*)::int n from public.order_lines`)).n === 0, '공급업체는 학교 주문 원장을 볼 수 없음');
});

console.log('\n[3] 주문확정 → 업체별 발주 자동생성');
await as(U.hc, async () => {
  const r = await one(`select public.confirm_orders($1,$2) r`, [HC, D]);
  ok(r.r.confirmed === 5, '5건 확정');
  const pos = (await db.query(`select s.code, po.po_no from public.purchase_orders po join public.suppliers s on s.id=po.supplier_id order by s.code`)).rows;
  ok(pos.map(p => p.code).join() === 'P01,P03,P04', '공급업체 3곳 발주 생성: ' + pos.map(p => p.po_no).join(' '));
  const pl = await one(`select qty from public.po_lines where item_id=$1`, [I01]);
  ok(Number(pl.qty) === 50, '감자 발주수량 = 홍천초 30 + 홍천중 20 = 50');
  await throws(() => db.query(`update public.order_lines set qty = 99 where school_id=$1 and item_id=$2`, [S101, I01]), /확정취소/, '확정 후 직접 수량 수정 차단');
  const u = await one(`select public.unconfirm_lines(array(select id from public.order_lines where school_id=$1 and item_id=$2)) r`, [S102, I01]);
  ok(u.r.unconfirmed === 1 && Number((await one(`select qty from public.po_lines where item_id=$1`, [I01])).qty) === 30, '확정취소 시 발주수량 차감 (50→30)');
  await db.query(`select public.confirm_orders($1,$2,$3)`, [HC, D, [S102]]);
  ok(Number((await one(`select qty from public.po_lines where item_id=$1`, [I01])).qty) === 50, '재확정 시 발주수량 누적 (30→50)');
});

console.log('\n[4] 공급업체 발주 확인');
const PO1 = (await one(`select id from public.purchase_orders where supplier_id=$1`, [P01])).id;
const PO3 = (await one(`select id from public.purchase_orders where supplier_id=$1`, [P03])).id;
await as(U.p01, async () => {
  ok((await one(`select count(*)::int n from public.purchase_orders`)).n === 1, '자기 발주 1건만 조회');
  await db.query(`select public.ack_po($1, $2::jsonb)`, [PO1, JSON.stringify([{ item_id: I01, ack_qty: 48 }])]);
  const a = await one(`select status from public.purchase_orders where id=$1`, [PO1]);
  ok(a.status === 'acknowledged', '발주 확인 완료 (감자 48 회신)');
  await throws(() => db.query(`select public.ack_po($1)`, [PO3]), /권한|찾을 수 없/, '다른 업체 발주 확인 불가');
});

console.log('\n[5] 입고 → 로트');
await as(U.hc, async () => {
  const r = await one(`select public.receive_po($1,$2::jsonb) r`, [PO1, JSON.stringify([{ item_id: I01, received_qty: 48 }])]);
  ok(r.r.shortages.length === 1 && Number(r.r.shortages[0].received) === 48, '부족 입고 감지: 감자 50 중 48');
  const lot = await one(`select lot_no, received_qty from public.lots where item_id=$1`, [I01]);
  ok(lot.lot_no === 'HC-261116-I01', '로트번호 ' + lot.lot_no);
  ok((await one(`select count(*)::int n from public.order_lines where status='received' and lot_id is not null`)).n === 3, '감자·양배추 3라인 입고완료 + 로트 연결');
  await db.query(`select public.receive_po(id) from public.purchase_orders where status <> 'received'`);
  ok((await one(`select count(*)::int n from public.purchase_orders where status='received'`)).n === 3, '나머지 발주 전량 입고');
});

console.log('\n[6] 출고 → 거래명세서 → 배송');
let ship;
await as(U.hc, async () => {
  const r = await one(`select public.ship_school($1,$2) r`, [S101, D]);
  ship = r.r.shipment_id;
  ok(r.r.shipped === 3, '홍천초 3건 출고확정');
  const st = await one(`select statement_no from public.shipments where id=$1`, [ship]);
  ok(st.statement_no === 'ST261116-S101', '거래명세서 ' + st.statement_no);
  const v = await one(`select sum(amount)::int a, sum(vat)::int v from public.v_order_lines where shipment_id=$1`, [ship]);
  ok(v.a === 30 * 2800 + Math.round(18.5 * 32000) + 2 * 12000 && v.v === 2400, `명세 금액 ${v.a}원, 부가세 ${v.v}원 (들기름만 과세)`);
  await throws(() => db.query(`select public.undo_receive($1)`, [PO1]), /출고/, '출고된 품목이 있으면 입고취소 불가');
  await db.query(`select public.ship_school($1,$2)`, [S102, D]);
  const co = await one(`select course_id from public.schools where id=$1`, [S101]);
  await db.query(`select public.course_run($1,$2,'depart')`, [co.course_id, D]);
  const st2 = await one(`select public.course_run($1,$2,'arrive') s`, [co.course_id, D]);
  ok(st2.s === 'arrived', 'A코스 도착 처리');
  ok((await one(`select count(*)::int n from public.order_lines where status='delivered'`)).n === 5, 'A코스 학교 5라인 배송완료');
});

console.log('\n[7] 학교 검수·클레임');
await as(U.s101, async () => {
  await db.query(`select public.confirm_receipt($1,'영양교사 홍○○')`, [ship]);
  ok((await one(`select received_by from public.shipments where id=$1`, [ship])).received_by === '영양교사 홍○○', '검수자 기록');
  const c = await one(`select public.create_claim($1,$2,$3,'품질불량',2,'일부 싹 발생','교환') r`, [S101, I01, D]);
  ok(c.r.claim_no === 'CL261116-001' && c.r.lot_id, '클레임 ' + c.r.claim_no + ' · 로트 자동 연결');
  ok((await one(`select count(*)::int n from public.lots`)).n === 3, '학교는 자기에게 납품된 로트만 조회 (3개)');
});
await as(U.s201, async () => {
  ok((await one(`select count(*)::int n from public.claims`)).n === 0, '춘천초는 홍천초 클레임 조회 불가');
});

console.log('\n[8] 도 통합 현황');
await as(U.prov, async () => {
  const rows = (await db.query(`select * from public.day_summary($1)`, [D])).rows;
  ok(rows.length === 2, '도 관리자는 센터 2곳 모두 집계');
  const hc = rows.find(r => r.center_name.startsWith('홍천'));
  ok(Number(hc.delivered) === 5 && Number(hc.open_claims) === 1, `홍천: 배송완료 ${hc.delivered}, 미결 클레임 ${hc.open_claims}`);
});
await as(U.hc, async () => {
  ok((await db.query(`select * from public.day_summary($1)`, [D])).rows.length === 1, '센터 관리자는 자기 센터만 집계');
});

console.log('\n[9] umji 연계 적재');
await as(U.hc, async () => {
  const rows = [
    { INV_SEQ: '9001', INV_SERL: '1', DELV_DATE: '20261105', CUST_SEQ: '501', CUST_NM: '홍천초등학교(umji)', ITEM_SEQ: '7001', ITEM_NM: '양파', SPEC: '상', QTY: '25', PRICE: '1800', PU_PRICE: '1600', TAX_KIND: '0', PU_CUST_NM: '남면 양파작목반' },
    { INV_SEQ: '9001', INV_SERL: '2', DELV_DATE: '20261105', CUST_SEQ: '501', CUST_NM: '홍천초등학교(umji)', ITEM_SEQ: '7002', ITEM_NM: '참기름', SPEC: '350ml', QTY: '1', PRICE: '13000', TAX_KIND: '1', PU_CUST_NM: '남면 양파작목반' },
    { INV_SEQ: '9002', INV_SERL: '1', CUST_SEQ: '502', ITEM_SEQ: '7001', QTY: '3' },
  ];
  const r = await one(`select public.umji_ingest($1,'shipments',$2::jsonb) r`, [HC, JSON.stringify(rows)]);
  ok(r.r.loaded === 3 && r.r.mapped === 2 && r.r.errors === 1, `적재 3 · 반영 2 · 오류 1 (납품일 없음)`);
  await db.query(`select public.umji_ingest($1,'shipments',$2::jsonb)`, [HC, JSON.stringify(rows.slice(0, 2))]);
  ok((await one(`select count(*)::int n from public.order_lines where external_ref like 'umji:%'`)).n === 2, '같은 행 재적재 시 중복 없음');
  ok((await one(`select tax from public.items where external_ref='umji:7002'`)).tax === 'taxable', '과세구분 변환');
  ok((await one(`select count(*)::int n from public.suppliers where name='남면 양파작목반'`)).n === 1, '공급업체 자동 등록');
});


console.log('\n[10] umji 전체 메뉴 모듈');
const D2 = '2026-11-23', D3 = '2026-12-07';
await as(U.hc, async () => {
  // 학교별할인율 5%
  await db.query(`insert into public.school_discounts(center_id, school_id, rate, valid_from) values ($1,$2,5,'2026-11-01')`, [HC, S102]);
  await db.query(`select public.save_order($1,$2,$3::jsonb,true)`, [S102, D2, JSON.stringify([{ item_id: I01, qty: 10 }, { item_id: I07, qty: 4 }])]);
  ok(Number((await one(`select sale_price from public.order_lines where school_id=$1 and item_id=$2 and delivery_date=$3`, [S102, I01, D2])).sale_price) === 2660, '학교별할인율 5% 적용 (2,800 → 2,660)');
  // 단가(일시)중단
  await db.query(`insert into public.item_suspensions(center_id, item_id, from_date, to_date, reason) values ($1,$2,'2026-11-23','2026-11-27','작황 불량')`, [HC, I02]);
  await throws(() => db.query(`select public.save_order($1,$2,$3::jsonb)`, [S102, D2, JSON.stringify([{ item_id: I02, qty: 3 }])]), /일시 중단/, '공급 중단 기간 주문 차단');
  // 주문변경요청 → 승인 시 발주수량 조정
  await db.query(`select public.confirm_orders($1,$2)`, [HC, D2]);
  const line = (await one(`select id from public.order_lines where school_id=$1 and item_id=$2 and delivery_date=$3`, [S102, I07, D2])).id;
  const req = (await one(`select public.request_order_change($1, 6, '학생 증가') r`, [line])).r;
  await throws(() => db.query(`select public.request_order_change($1, 7, '중복')`, [line]), /대기/, '처리 대기 중 중복 요청 차단');
  await db.query(`select public.process_order_change($1, true, '반영')`, [req]);
  const pl = await one(`select pl.qty from public.po_lines pl join public.order_lines ol on ol.po_line_id = pl.id where ol.id=$1`, [line]);
  ok(Number(pl.qty) === 6, '변경 승인 → 주문·발주수량 4 → 6');
  // 마감 (주문마감)
  await db.query(`insert into public.closings(center_id, period, order_closed) values ($1,'2026-12',true)`, [HC]);
  await throws(() => db.query(`select public.save_order($1,$2,$3::jsonb)`, [S102, D3, JSON.stringify([{ item_id: I01, qty: 1 }])]), /마감/, '12월 주문마감 후 주문 차단');
  // 거래처별 마감 (공급업체 P03 → 입고 차단)
  await db.query(`insert into public.partner_closings(center_id, period, partner_type, supplier_id) values ($1,'2026-11','공급업체',$2)`, [HC, P03]);
  const po3 = (await one(`select id from public.purchase_orders where supplier_id=$1 and delivery_date=$2`, [P03, D2])).id;
  await throws(() => db.query(`select public.receive_po($1)`, [po3]), /마감/, '거래처별 마감된 업체 입고 차단');
  await db.query(`delete from public.partner_closings where center_id=$1`, [HC]);
  // 보조금 정산
  await db.query(`update public.items set subsidy_type='친환경(우수)식재료비' where id=$1`, [I01]);
  await db.query(`insert into public.subsidy_monthly(center_id, school_id, month, subsidy_type, amount) values ($1,$2,'2026-11','친환경(우수)식재료비',100000)`, [HC, S101]);
  const st = await one(`select public.settle_subsidies($1,'2026-11') r`, [HC]);
  const row = await one(`select budget, used, settled_amount from public.subsidy_settlements where school_id=$1 and month='2026-11'`, [S101]);
  ok(st.r.rows === 1 && Number(row.used) === 84000 && Number(row.settled_amount) === 84000, `보조금 정산: 예산 100,000 / 사용 ${row.used} / 정산 ${row.settled_amount}`);
  // 상품화 → 재고
  await db.query(`insert into public.work_orders(center_id, work_date, raw_name, input_qty, item_id, output_qty, status) values ($1,'2026-11-10','감자 원물',100,$2,92,'완료')`, [HC, I01]);
  await db.query(`insert into public.stock_moves(center_id, item_id, move_date, qty, kind) values ($1,$2,'2026-11-11',30,'입고_유통')`, [HC, I01]);
  const stock = await one(`select * from public.report_stock($1,'2026-11-01','2026-11-30') where 상품코드='I01'`, [HC]);
  ok(Number(stock.기말재고) === 122, '재고현황: 상품화 92 + 유통입고 30 = 122');
  // 통계 RPC 전체 실행
  const reps = ['report_sales','report_sales_daily','report_supply','report_order_frequency','report_local_food','report_eco_food','report_po_status','report_claims','report_subsidy','report_subsidy_year','report_stock','report_cert_check','report_trace','report_std_items','report_trades'];
  let okc = 0;
  for (const r of reps) { try { await db.query(`select * from public.${r}($1,'2026-11-01','2026-11-30')`, [HC]); okc++; } catch (e) { console.log('   ', r, e.message); } }
  ok(okc === reps.length, `통계·현황 함수 ${okc}/${reps.length} 실행`);
  const local = await one(`select * from public.report_local_food($1,'2026-11-01','2026-11-30') where 학교='홍천초등학교'`, [HC]);
  ok(Number(local.도내산비율) === 100, '도내산 사용비율 100% (강원 홍천산)');
  // 공유상품
  await db.query(`insert into public.shared_items(center_id, item_id, share_price) values ($1,$2,3000)`, [HC, I01]);
});
await as(U.cc, async () => {
  const m = (await db.query(`select * from public.shared_market($1)`, [CC])).rows;
  ok(m.length === 1 && m[0].상품 === '감자(수미)', '춘천센터에서 홍천 공유상품 조회');
  const tid = (await one(`select public.request_trade($1,$2,'2026-11-20',50) r`, [CC, m[0].id])).r;
  await throws(() => db.query(`select public.trade_step($1,'승인')`, [tid]), /판매 센터/, '구매 센터는 승인 불가');
  globalThis.__tid = tid;
});
await as(U.hc, async () => {
  await db.query(`select public.trade_step($1,'승인')`, [globalThis.__tid]);
  await db.query(`select public.trade_step($1,'출고')`, [globalThis.__tid]);
});
await as(U.cc, async () => {
  await db.query(`select public.trade_step($1,'완료')`, [globalThis.__tid]);
  const t = (await db.query(`select * from public.my_trades($1)`, [CC])).rows[0];
  ok(t.상태 === '완료' && t.구분 === '매입' && Number(t.금액) === 150000, '센터 간 거래 요청→승인→출고→완료 (150,000원)');
  ok((await one(`select count(*)::int n from public.market_prices`)).n === 0, '춘천센터는 홍천 시장조사단가 조회 불가');
});
await as(U.s101, async () => {
  ok((await one(`select count(*)::int n from public.subsidy_monthly`)).n === 1, '학교는 자기 학교 보조금만 조회');
  await db.query(`insert into public.posts(center_id, board, title, body, created_by) values ($1,'자유','안녕하세요','본문',$2)`, [HC, U.s101]);
  await throws(() => db.query(`insert into public.posts(center_id, board, title, body, created_by) values ($1,'공지','공지','본문',$2)`, [HC, U.s101]), /./, '학교는 공지 작성 불가');
});
await as(U.prov, async () => {
  await db.query(`insert into public.posts(center_id, board, title, body, created_by) values (null,'공지','도 전체 공지','본문',$1)`, [U.prov]);
});
await as(U.p01, async () => {
  ok((await one(`select count(*)::int n from public.posts`)).n === 2, '공급업체: 도 전체 공지 + 같은 센터 자유글 조회');
});

console.log(`\n결과: ${pass} 통과, ${fail} 실패`);
await db.close?.();
process.exit(fail ? 1 : 0);
