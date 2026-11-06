-- 0005: umji 전체 메뉴 대응 모듈
-- 주문관리(시장조사단가·임시견적·주문변경·마감), 상품관리(단가중단·표준식재료·NEIS·원물·재고·센터간거래·인증·안전성),
-- 보조금관리, 기준정보(생산자·창고·권역·할인율·인장·차량·기사), 커뮤니티, 시스템관리, 통계

-- ---------------------------------------------------------------- 기준정보
create table public.regions (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers(id) on delete cascade,
  code text not null, name text not null, note text,
  unique (center_id, code)
);
alter table public.schools add column region_id uuid references public.regions(id) on delete set null;
alter table public.schools add column phone text;
alter table public.schools add column dietitian text;

create table public.producers (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete set null,
  name text not null, area text, phone text, farm_size text, crops text,
  cert_type text, cert_no text, note text, active boolean not null default true
);

create table public.warehouses (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers(id) on delete cascade,
  code text not null, name text not null, storage public.storage_type not null default 'chilled',
  capacity text, location text, active boolean not null default true,
  unique (center_id, code)
);

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers(id) on delete cascade,
  plate text not null, model text, capacity_kg numeric, refrigerated boolean not null default true,
  inspection_due date, active boolean not null default true, note text,
  unique (center_id, plate)
);
create table public.drivers (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers(id) on delete cascade,
  name text not null, phone text, license_no text, hired_on date, active boolean not null default true, note text
);
alter table public.courses add column vehicle_id uuid references public.vehicles(id) on delete set null;
alter table public.courses add column driver_id uuid references public.drivers(id) on delete set null;
alter table public.courses add column region_id uuid references public.regions(id) on delete set null;

create table public.school_discounts (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  rate numeric(5,2) not null check (rate >= 0 and rate < 100),
  valid_from date not null, valid_to date not null default '9999-12-31', note text,
  check (valid_from <= valid_to)
);

create table public.school_matching_history (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  field text not null, old_value text, new_value text,
  changed_at timestamptz not null default now(), changed_by uuid
);

create table public.seals (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers(id) on delete cascade,
  name text not null, image_data text, is_default boolean not null default false, note text
);

-- ---------------------------------------------------------------- 상품관리
alter table public.items add column neis_food_code text;
alter table public.items add column std_attr text;
alter table public.items add column subsidy_type text check (subsidy_type in ('학교식품비','친환경(우수)식재료비','지역보조금','제철과일급식','Non-GMO','기타'));
alter table public.items add column pack_unit text;
alter table public.items add column description text;

-- 단가 화면을 센터 단위로 조회할 수 있도록 센터 컬럼 추가 (상품에서 자동 채움)
alter table public.item_prices add column center_id uuid references public.centers(id) on delete cascade;
update public.item_prices p set center_id = i.center_id from public.items i where i.id = p.item_id;
create or replace function app.tg_item_prices() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.center_id := (select center_id from public.items where id = new.item_id);
  return new;
end $$;
create trigger item_prices_center before insert or update on public.item_prices for each row execute function app.tg_item_prices();

create table public.item_suspensions (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  from_date date not null, to_date date not null, reason text,
  check (from_date <= to_date)
);

create table public.standard_attrs (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers(id) on delete cascade,
  attr_name text not null, attr_value text not null, sort integer not null default 0
);

create table public.neis_foods (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers(id) on delete cascade,
  code text not null, name text not null, category text, unit text, allergy text, waste_rate numeric(5,2), use_yn boolean not null default true,
  unique (center_id, code)
);

create table public.market_prices (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers(id) on delete cascade,
  survey_date date not null default current_date,
  item_id uuid not null references public.items(id) on delete cascade,
  market text not null, market_price numeric(12,2) not null, proposed_price numeric(12,2), note text
);

create table public.certifications (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete cascade,
  producer_id uuid references public.producers(id) on delete cascade,
  item_id uuid references public.items(id) on delete set null,
  cert_type text not null, cert_no text not null, issuer text,
  valid_from date not null, valid_to date not null, note text
);

create table public.safety_tests (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers(id) on delete cascade,
  test_date date not null default current_date,
  item_id uuid not null references public.items(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete set null,
  lot_id uuid references public.lots(id) on delete set null,
  test_type text not null check (test_type in ('잔류농약','중금속','방사능','미생물','기타')),
  agency text, result text not null check (result in ('적합','부적합','검사중')), note text
);

-- 원물·상품화·재고
create table public.raw_orders (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers(id) on delete cascade,
  order_date date not null default current_date,
  supplier_id uuid references public.suppliers(id) on delete set null,
  producer_id uuid references public.producers(id) on delete set null,
  raw_name text not null, unit text not null default 'kg', qty numeric(12,2) not null, price numeric(12,2),
  status text not null default '발주' check (status in ('발주','입고완료','취소')), note text
);
create table public.raw_receipts (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers(id) on delete cascade,
  raw_order_id uuid references public.raw_orders(id) on delete set null,
  receipt_date date not null default current_date,
  raw_name text not null, qty numeric(12,2) not null,
  warehouse_id uuid references public.warehouses(id) on delete set null, lot_no text, note text
);
create table public.work_orders (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers(id) on delete cascade,
  work_date date not null default current_date,
  raw_receipt_id uuid references public.raw_receipts(id) on delete set null,
  raw_name text, input_qty numeric(12,2) not null,
  item_id uuid not null references public.items(id), output_qty numeric(12,2),
  status text not null default '지시' check (status in ('지시','완료')), worker text, note text
);
create table public.work_logs (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers(id) on delete cascade,
  work_date date not null default current_date, worker text not null, task text not null, hours numeric(5,1), note text
);
create table public.stock_moves (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers(id) on delete cascade,
  item_id uuid not null references public.items(id),
  move_date date not null default current_date,
  qty numeric(12,2) not null,
  kind text not null check (kind in ('입고_유통','상품화','출고','폐기','조정')),
  warehouse_id uuid references public.warehouses(id) on delete set null,
  ref text, note text
);

-- 센터 간 거래
create table public.shared_items (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  share_price numeric(12,2) not null, available_from date not null default current_date, available_to date,
  min_qty numeric(12,2), note text
);
create table public.center_trades (
  id uuid primary key default gen_random_uuid(),
  buyer_center_id uuid not null references public.centers(id) on delete cascade,
  seller_center_id uuid not null references public.centers(id) on delete cascade,
  shared_item_id uuid not null references public.shared_items(id) on delete cascade,
  trade_date date not null, qty numeric(12,2) not null check (qty > 0), price numeric(12,2) not null,
  status text not null default '요청' check (status in ('요청','승인','출고','완료','반려')),
  note text, created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- 주문관리
create table public.temp_estimates (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  item_id uuid not null references public.items(id) on delete cascade,
  qty numeric(12,2) not null, note text,
  unique (school_id, month, item_id)
);

create table public.order_change_requests (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  order_line_id uuid references public.order_lines(id) on delete set null,
  item_name text, delivery_date date,
  old_qty numeric(12,2) not null, requested_qty numeric(12,2) not null check (requested_qty >= 0),
  reason text, status text not null default '요청' check (status in ('요청','승인','반려')),
  reply text, requested_by uuid, processed_by uuid, processed_at timestamptz,
  created_at timestamptz not null default now()
);

-- 마감처리(업무별): umji와 같이 월별 한 줄에 업무별 마감 여부
create table public.closings (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers(id) on delete cascade,
  period text not null check (period ~ '^\d{4}-\d{2}$'),
  start_date date, end_date date,
  price_closed boolean not null default false,
  estimate_closed boolean not null default false,
  order_closed boolean not null default false,
  po_closed boolean not null default false,
  ship_closed boolean not null default false,
  claim_closed boolean not null default false,
  settle_closed boolean not null default false,
  note text,
  unique (center_id, period)
);
-- 마감처리(거래처별)
create table public.partner_closings (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers(id) on delete cascade,
  period text not null check (period ~ '^\d{4}-\d{2}$'),
  partner_type text not null check (partner_type in ('학교','공급업체')),
  school_id uuid references public.schools(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete cascade,
  closed boolean not null default true, note text
);

-- ---------------------------------------------------------------- 보조금
create table public.subsidy_standards (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers(id) on delete cascade,
  year integer not null, school_level text not null,
  meal_unit_price numeric(12,2) not null, local_ratio_target numeric(5,2), eco_ratio_target numeric(5,2), note text
);
create table public.subsidy_budgets (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  year integer not null, subsidy_type text not null check (subsidy_type in ('학교식품비','친환경(우수)식재료비','지역보조금','제철과일급식','Non-GMO','기타')),
  amount numeric(14,0) not null, note text,
  unique (school_id, year, subsidy_type)
);
create table public.subsidy_monthly (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  subsidy_type text not null check (subsidy_type in ('학교식품비','친환경(우수)식재료비','지역보조금','제철과일급식','Non-GMO','기타')),
  amount numeric(14,0) not null, students integer, meal_days integer, unit_price numeric(12,0), note text,
  unique (school_id, month, subsidy_type)
);
create table public.subsidy_settlements (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  month text not null, subsidy_type text not null,
  budget numeric(14,0) not null default 0, used numeric(14,0) not null default 0, settled_amount numeric(14,0) not null default 0,
  status text not null default '미정산' check (status in ('미정산','정산완료')), settled_at timestamptz, note text,
  unique (school_id, month, subsidy_type)
);

-- ---------------------------------------------------------------- 커뮤니티·시스템
create table public.posts (
  id uuid primary key default gen_random_uuid(),
  center_id uuid references public.centers(id) on delete cascade,  -- null = 도 전체 공지
  board text not null check (board in ('공지','자유')),
  title text not null, body text not null, author_name text, created_by uuid,
  pinned boolean not null default false, views integer not null default 0,
  created_at timestamptz not null default now()
);
create table public.common_codes (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers(id) on delete cascade,
  group_code text not null, code text not null, name text not null, sort integer not null default 0, use_yn boolean not null default true,
  unique (center_id, group_code, code)
);
create table public.glossary (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers(id) on delete cascade,
  term text not null, description text
);
create table public.app_messages (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers(id) on delete cascade,
  msg_id text not null, msg_type text not null default '안내', text text not null,
  unique (center_id, msg_id)
);
create table public.role_permissions (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers(id) on delete cascade,
  role public.app_role not null, screen text not null,
  can_view boolean not null default true, can_save boolean not null default true, can_delete boolean not null default false,
  can_print boolean not null default true, can_excel boolean not null default true,
  unique (center_id, role, screen)
);
create table public.access_logs (
  id bigserial primary key,
  user_id uuid, email text, role text, center_id uuid,
  action text not null, ip text, user_agent text, at timestamptz not null default now()
);

-- ---------------------------------------------------------------- RLS (센터 범위 공통)
do $$
declare t text;
begin
  foreach t in array array['regions','producers','warehouses','vehicles','drivers','school_discounts','school_matching_history','seals',
    'item_suspensions','standard_attrs','neis_foods','market_prices','certifications','safety_tests','raw_orders','raw_receipts',
    'work_orders','work_logs','stock_moves','temp_estimates','closings','partner_closings','subsidy_standards','subsidy_budgets','subsidy_monthly',
    'subsidy_settlements','common_codes','glossary','app_messages','role_permissions']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select using (app.in_center(center_id))', t || '_read', t);
    execute format('create policy %I on public.%I for all using (app.is_staff(center_id)) with check (app.is_staff(center_id))', t || '_write', t);
  end loop;
end $$;

-- 학교는 자기 학교의 보조금·임시견적만, 공급업체는 자기 인증·생산자만 보이도록 좁힘
drop policy subsidy_budgets_read on public.subsidy_budgets;
create policy subsidy_budgets_read on public.subsidy_budgets for select using (app.is_staff(center_id) or school_id = app.school());
drop policy subsidy_monthly_read on public.subsidy_monthly;
create policy subsidy_monthly_read on public.subsidy_monthly for select using (app.is_staff(center_id) or school_id = app.school());
drop policy subsidy_settlements_read on public.subsidy_settlements;
create policy subsidy_settlements_read on public.subsidy_settlements for select using (app.is_staff(center_id) or school_id = app.school());
drop policy temp_estimates_read on public.temp_estimates;
create policy temp_estimates_read on public.temp_estimates for select using (app.is_staff(center_id) or school_id = app.school());
create policy temp_estimates_school on public.temp_estimates for all using (school_id = app.school()) with check (school_id = app.school() and center_id = app.center());
drop policy school_discounts_read on public.school_discounts;
create policy school_discounts_read on public.school_discounts for select using (app.is_staff(center_id) or school_id = app.school());
drop policy school_matching_history_read on public.school_matching_history;
create policy school_matching_history_read on public.school_matching_history for select using (app.is_staff(center_id));
drop policy certifications_read on public.certifications;
create policy certifications_read on public.certifications for select using (app.is_staff(center_id) or supplier_id = app.supplier() or app.role() = 'school' and app.in_center(center_id));
create policy certifications_supplier on public.certifications for insert with check (supplier_id = app.supplier() and center_id = app.center());
drop policy producers_read on public.producers;
create policy producers_read on public.producers for select using (app.is_staff(center_id) or supplier_id = app.supplier());
drop policy role_permissions_read on public.role_permissions;
create policy role_permissions_read on public.role_permissions for select using (app.in_center(center_id));

alter table public.order_change_requests enable row level security;
create policy ocr_read on public.order_change_requests for select using (app.is_staff(center_id) or school_id = app.school());
create policy ocr_staff on public.order_change_requests for all using (app.is_staff(center_id)) with check (app.is_staff(center_id));

alter table public.shared_items enable row level security;
-- 공유상품은 모든 센터 관리자가 볼 수 있음
create policy shared_read on public.shared_items for select using (app.role() in ('province_admin','center_admin'));
create policy shared_write on public.shared_items for all using (app.is_staff(center_id)) with check (app.is_staff(center_id));

alter table public.center_trades enable row level security;
create policy trades_read on public.center_trades for select using (app.is_staff(buyer_center_id) or app.is_staff(seller_center_id));
create policy trades_buyer on public.center_trades for insert with check (app.is_staff(buyer_center_id) and status = '요청');

alter table public.posts enable row level security;
create policy posts_read on public.posts for select using (center_id is null and auth.uid() is not null or app.in_center(center_id));
create policy posts_insert on public.posts for insert with check (
  created_by = auth.uid() and (
    (board = '공지' and (app.role() = 'province_admin' or (center_id is not null and app.is_staff(center_id))))
    or (board = '자유' and center_id is not null and app.in_center(center_id))));
create policy posts_update on public.posts for update using (created_by = auth.uid() or (center_id is not null and app.is_staff(center_id)) or app.role() = 'province_admin');
create policy posts_delete on public.posts for delete using (created_by = auth.uid() or (center_id is not null and app.is_staff(center_id)) or app.role() = 'province_admin');

alter table public.access_logs enable row level security;
create policy access_read on public.access_logs for select using (app.role() = 'province_admin' or (center_id is not null and app.is_staff(center_id)));
create policy access_insert on public.access_logs for insert with check (user_id = auth.uid());

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- ---------------------------------------------------------------- 규칙: 할인율·단가중단·마감
create or replace function app.is_closed(p_center uuid, p_date date, p_kind text, p_school uuid default null, p_supplier uuid default null)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.closings c
    where c.center_id = p_center and c.period = to_char(p_date, 'YYYY-MM')
      and case p_kind when '주문' then c.order_closed when '입고' then c.po_closed when '출고' then c.ship_closed
                      when '클레임' then c.claim_closed when '정산' then c.settle_closed else false end)
  or exists (
    select 1 from public.partner_closings x
    where x.center_id = p_center and x.period = to_char(p_date, 'YYYY-MM') and x.closed
      and ((x.partner_type = '학교' and x.school_id = p_school) or (x.partner_type = '공급업체' and x.supplier_id = p_supplier)))
$$;

create or replace function app.tg_order_lines() returns trigger
language plpgsql security definer set search_path = public as $$
declare o public.orders; it public.items; pr record; disc numeric; susp text;
begin
  select * into o from public.orders where id = new.order_id;
  if o.id is null then raise exception '주문을 찾을 수 없습니다'; end if;
  new.center_id := o.center_id;
  new.school_id := o.school_id;
  new.delivery_date := o.delivery_date;

  select * into it from public.items where id = new.item_id;
  if it.id is null or it.center_id <> o.center_id then raise exception '이 센터에 등록되지 않은 상품입니다'; end if;

  if not app.in_rpc() then
    if tg_op = 'INSERT' and new.status not in ('draft','submitted') then
      raise exception '주문 라인은 작성중 또는 제출 상태로만 만들 수 있습니다';
    end if;
    if tg_op = 'UPDATE' and old.status not in ('draft','submitted') and
       (new.qty <> old.qty or new.item_id <> old.item_id or new.status <> old.status) then
      raise exception '확정된 주문(%)은 확정취소 후 수정하세요', old.status;
    end if;
    if tg_op = 'UPDATE' and new.status not in ('draft','submitted') and new.status <> old.status then
      raise exception '상태 변경은 업무 기능으로만 할 수 있습니다';
    end if;
  end if;

  -- 마감 확인 (상태가 바뀌는 단계별)
  if new.status in ('draft','submitted','confirmed') and (tg_op = 'INSERT' or new.qty <> old.qty or new.status <> old.status)
     and app.is_closed(o.center_id, o.delivery_date, '주문', o.school_id, it.supplier_id) then
    raise exception '% 주문이 마감되었습니다. 센터에 문의하세요', to_char(o.delivery_date, 'YYYY-MM');
  end if;
  if new.status = 'received' and (tg_op = 'INSERT' or old.status <> 'received')
     and app.is_closed(o.center_id, o.delivery_date, '입고', null, it.supplier_id) then
    raise exception '% 입고가 마감되었습니다', to_char(o.delivery_date, 'YYYY-MM');
  end if;
  if new.status = 'shipped' and (tg_op = 'INSERT' or old.status <> 'shipped') and coalesce(new.external_ref, '') not like 'umji:%'
     and app.is_closed(o.center_id, o.delivery_date, '출고', o.school_id, null) then
    raise exception '% 출고가 마감되었습니다', to_char(o.delivery_date, 'YYYY-MM');
  end if;

  if new.status in ('draft','submitted') then
    if not it.active then raise exception '% 상품은 사용 중지되었습니다', it.name; end if;
    select reason into susp from public.item_suspensions s
    where s.item_id = new.item_id and o.delivery_date between s.from_date and s.to_date limit 1;
    if found then raise exception '% 상품은 % 공급이 일시 중단되었습니다 (%)', it.name, o.delivery_date, coalesce(susp, '사유 미기재'); end if;
    select * into pr from public.price_on(new.item_id, o.delivery_date);
    if pr.sale_price is null then
      raise exception '% 상품의 % 납품 단가가 등록되지 않았습니다', it.name, o.delivery_date;
    end if;
    select rate into disc from public.school_discounts d
    where d.school_id = o.school_id and o.delivery_date between d.valid_from and d.valid_to order by valid_from desc limit 1;
    new.sale_price := round(pr.sale_price * (1 - coalesce(disc, 0) / 100), 0);
    new.purchase_price := pr.purchase_price;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- 학교 배송코스·권역 변경 이력 (학교별매칭이력)
create or replace function app.tg_school_history() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.course_id is distinct from old.course_id then
    insert into public.school_matching_history(center_id, school_id, field, old_value, new_value, changed_by)
    values (new.center_id, new.id, '배송코스',
      (select name from public.courses where id = old.course_id), (select name from public.courses where id = new.course_id), auth.uid());
  end if;
  if new.region_id is distinct from old.region_id then
    insert into public.school_matching_history(center_id, school_id, field, old_value, new_value, changed_by)
    values (new.center_id, new.id, '권역',
      (select name from public.regions where id = old.region_id), (select name from public.regions where id = new.region_id), auth.uid());
  end if;
  if new.delivery_seq is distinct from old.delivery_seq then
    insert into public.school_matching_history(center_id, school_id, field, old_value, new_value, changed_by)
    values (new.center_id, new.id, '배송순서', old.delivery_seq::text, new.delivery_seq::text, auth.uid());
  end if;
  return new;
end $$;
create trigger schools_history after update on public.schools for each row execute function app.tg_school_history();

-- 상품화 완료 → 재고 반영
create or replace function app.tg_work_orders() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = '완료' and (tg_op = 'INSERT' or old.status <> '완료') then
    if new.output_qty is null then raise exception '완료 처리하려면 생산수량을 입력하세요'; end if;
    insert into public.stock_moves(center_id, item_id, move_date, qty, kind, ref, note)
    values (new.center_id, new.item_id, new.work_date, new.output_qty, '상품화', 'work:' || new.id, new.raw_name);
  end if;
  return new;
end $$;
create trigger work_orders_stock after insert or update on public.work_orders for each row execute function app.tg_work_orders();

-- 원물입고 → 원물발주 입고완료
create or replace function app.tg_raw_receipts() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.raw_order_id is not null then
    update public.raw_orders set status = '입고완료' where id = new.raw_order_id and status = '발주';
  end if;
  return new;
end $$;
create trigger raw_receipts_done after insert on public.raw_receipts for each row execute function app.tg_raw_receipts();

-- ---------------------------------------------------------------- 업무 함수
-- 주문변경요청 (학교: 확정·입고 전 품목의 수량 변경 요청)
create or replace function public.request_order_change(p_line_id uuid, p_qty numeric, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare l public.order_lines; v uuid;
begin
  select * into l from public.order_lines where id = p_line_id;
  if l.id is null or not (app.school() is not distinct from l.school_id or app.is_staff(l.center_id)) then raise exception '권한이 없습니다'; end if;
  if l.status not in ('submitted','confirmed') then raise exception '입고 이후 품목은 변경을 요청할 수 없습니다. 클레임으로 접수하세요'; end if;
  if exists (select 1 from public.order_change_requests where order_line_id = p_line_id and status = '요청') then
    raise exception '이미 처리 대기 중인 변경 요청이 있습니다';
  end if;
  insert into public.order_change_requests(center_id, school_id, order_line_id, item_name, delivery_date, old_qty, requested_qty, reason, requested_by)
  values (l.center_id, l.school_id, l.id, (select name from public.items where id = l.item_id), l.delivery_date, l.qty, p_qty, p_reason, auth.uid())
  returning id into v;
  return v;
end $$;

-- 주문변경 승인/반려 (센터) — 확정 품목이면 발주수량도 함께 조정
create or replace function public.process_order_change(p_id uuid, p_approve boolean, p_reply text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.order_change_requests; l public.order_lines; diff numeric;
begin
  select * into r from public.order_change_requests where id = p_id for update;
  if r.id is null or not app.is_staff(r.center_id) then raise exception '권한이 없습니다'; end if;
  if r.status <> '요청' then raise exception '이미 처리된 요청입니다'; end if;
  perform app.rpc_on();
  if p_approve then
    select * into l from public.order_lines where id = r.order_line_id for update;
    if l.id is null then raise exception '주문 품목이 이미 삭제되었습니다'; end if;
    if l.status not in ('submitted','confirmed') then raise exception '이미 입고된 품목이라 변경할 수 없습니다'; end if;
    diff := r.requested_qty - l.qty;
    if r.requested_qty = 0 then
      if l.po_line_id is not null then update public.po_lines set qty = qty - l.qty where id = l.po_line_id; end if;
      delete from public.order_lines where id = l.id;
    else
      if l.po_line_id is not null then update public.po_lines set qty = qty + diff, ack_qty = null where id = l.po_line_id; end if;
      update public.order_lines set qty = r.requested_qty where id = l.id;
    end if;
  end if;
  update public.order_change_requests set status = case when p_approve then '승인' else '반려' end,
         reply = p_reply, processed_by = auth.uid(), processed_at = now() where id = p_id;
  perform app.log(r.center_id, 'order.change.' || case when p_approve then 'approve' else 'reject' end, p_id::text, null);
  return jsonb_build_object('status', case when p_approve then '승인' else '반려' end);
end $$;

-- 보조금 정산 계산 (월): 배정액 대비 출고·배송된 해당 유형 품목 금액
create or replace function public.settle_subsidies(p_center_id uuid, p_month text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not app.is_staff(p_center_id) then raise exception '권한이 없습니다'; end if;
  insert into public.subsidy_settlements(center_id, school_id, month, subsidy_type, budget, used, settled_amount)
  select p_center_id, b.school_id, p_month, b.subsidy_type, b.amount,
         coalesce(u.used, 0), least(b.amount, coalesce(u.used, 0))
  from public.subsidy_monthly b
  left join (
    select ol.school_id, i.subsidy_type, sum(round(ol.qty * ol.sale_price)) used
    from public.order_lines ol join public.items i on i.id = ol.item_id
    where ol.center_id = p_center_id and to_char(ol.delivery_date, 'YYYY-MM') = p_month and ol.status in ('shipped','delivered')
    group by ol.school_id, i.subsidy_type) u on u.school_id = b.school_id and u.subsidy_type = b.subsidy_type
  where b.center_id = p_center_id and b.month = p_month
  on conflict (school_id, month, subsidy_type) do update
    set budget = excluded.budget, used = excluded.used,
        settled_amount = case when subsidy_settlements.status = '정산완료' then subsidy_settlements.settled_amount else excluded.settled_amount end;
  get diagnostics n = row_count;
  return jsonb_build_object('rows', n);
end $$;

-- 센터 간 거래 상태 변경 (판매 센터: 승인·반려·출고 / 구매 센터: 완료)
create or replace function public.trade_step(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare t public.center_trades;
begin
  select * into t from public.center_trades where id = p_id for update;
  if t.id is null then raise exception '거래를 찾을 수 없습니다'; end if;
  if p_status in ('승인','반려','출고') and not app.is_staff(t.seller_center_id) then raise exception '판매 센터만 처리할 수 있습니다'; end if;
  if p_status = '완료' and not app.is_staff(t.buyer_center_id) then raise exception '구매 센터만 입고 완료할 수 있습니다'; end if;
  if not ((t.status = '요청' and p_status in ('승인','반려')) or (t.status = '승인' and p_status = '출고') or (t.status = '출고' and p_status = '완료')) then
    raise exception '% 상태에서는 %(으)로 바꿀 수 없습니다', t.status, p_status;
  end if;
  update public.center_trades set status = p_status where id = p_id;
end $$;

-- ---------------------------------------------------------------- 통계·현황 (기간: p_from ~ p_to)
create or replace function public.report_sales(p_center_id uuid, p_from date, p_to date, p_group text default 'school')
returns table (구분 text, 코드 text, 라인 bigint, 수량 numeric, 매출금액 numeric, 부가세 numeric, 매입금액 numeric, 차액 numeric)
language sql stable security definer set search_path = public as $$
  select case p_group when 'supplier' then sp.name when 'item' then i.name else s.name end,
         case p_group when 'supplier' then sp.code when 'item' then i.code else s.code end,
         count(*), sum(ol.qty), sum(round(ol.qty * ol.sale_price)),
         sum(case when i.tax = 'taxable' then round(ol.qty * ol.sale_price * 0.1) else 0 end),
         sum(round(ol.qty * ol.purchase_price)), sum(round(ol.qty * ol.sale_price)) - sum(round(ol.qty * ol.purchase_price))
  from public.order_lines ol join public.schools s on s.id = ol.school_id join public.items i on i.id = ol.item_id
  left join public.suppliers sp on sp.id = i.supplier_id
  where app.is_staff(p_center_id) and ol.center_id = p_center_id and ol.delivery_date between p_from and p_to and ol.status in ('shipped','delivered')
  group by 1, 2 order by 1
$$;

create or replace function public.report_sales_daily(p_center_id uuid, p_from date, p_to date)
returns table (납품일 date, 학교수 bigint, 라인 bigint, 매출금액 numeric, 부가세 numeric, 매입금액 numeric)
language sql stable security definer set search_path = public as $$
  select ol.delivery_date, count(distinct ol.school_id), count(*), sum(round(ol.qty * ol.sale_price)),
         sum(case when i.tax = 'taxable' then round(ol.qty * ol.sale_price * 0.1) else 0 end), sum(round(ol.qty * ol.purchase_price))
  from public.order_lines ol join public.items i on i.id = ol.item_id
  where app.is_staff(p_center_id) and ol.center_id = p_center_id and ol.delivery_date between p_from and p_to and ol.status in ('shipped','delivered')
  group by 1 order by 1
$$;

create or replace function public.report_supply(p_center_id uuid, p_from date, p_to date)
returns table (분류 text, 공급업체 text, 품목수 bigint, 수량 numeric, 금액 numeric)
language sql stable security definer set search_path = public as $$
  select coalesce(i.category, '미분류'), coalesce(sp.name, '미지정'), count(distinct i.id), sum(ol.qty), sum(round(ol.qty * ol.sale_price))
  from public.order_lines ol join public.items i on i.id = ol.item_id left join public.suppliers sp on sp.id = i.supplier_id
  where app.is_staff(p_center_id) and ol.center_id = p_center_id and ol.delivery_date between p_from and p_to and ol.status not in ('draft','canceled')
  group by 1, 2 order by 1, 5 desc
$$;

create or replace function public.report_order_frequency(p_center_id uuid, p_from date, p_to date)
returns table (상품코드 text, 상품명 text, 발주횟수 bigint, 주문학교수 bigint, 총수량 numeric, 단위 text)
language sql stable security definer set search_path = public as $$
  select i.code, i.name, count(distinct ol.order_id), count(distinct ol.school_id), sum(ol.qty), i.unit
  from public.order_lines ol join public.items i on i.id = ol.item_id
  where app.is_staff(p_center_id) and ol.center_id = p_center_id and ol.delivery_date between p_from and p_to and ol.status not in ('draft','canceled')
  group by i.code, i.name, i.unit order by 3 desc, 5 desc
$$;

create or replace function public.report_local_food(p_center_id uuid, p_from date, p_to date)
returns table (학교 text, 전체금액 numeric, 도내산금액 numeric, 도내산비율 numeric, 친환경금액 numeric, 친환경비율 numeric)
language sql stable security definer set search_path = public as $$
  select s.name, sum(round(ol.qty * ol.sale_price)),
         sum(round(ol.qty * ol.sale_price)) filter (where i.origin_detail like '강원%'),
         round(100.0 * coalesce(sum(ol.qty * ol.sale_price) filter (where i.origin_detail like '강원%'), 0) / nullif(sum(ol.qty * ol.sale_price), 0), 1),
         sum(round(ol.qty * ol.sale_price)) filter (where i.cert_type in ('유기농','무농약','무항생제','동물복지','GAP')),
         round(100.0 * coalesce(sum(ol.qty * ol.sale_price) filter (where i.cert_type in ('유기농','무농약','무항생제','동물복지','GAP')), 0) / nullif(sum(ol.qty * ol.sale_price), 0), 1)
  from public.order_lines ol join public.schools s on s.id = ol.school_id join public.items i on i.id = ol.item_id
  where app.is_staff(p_center_id) and ol.center_id = p_center_id and ol.delivery_date between p_from and p_to and ol.status not in ('draft','canceled')
  group by s.name order by s.name
$$;

create or replace function public.report_eco_food(p_center_id uuid, p_from date, p_to date)
returns table (인증구분 text, 품목수 bigint, 수량 numeric, 금액 numeric, 비율 numeric)
language sql stable security definer set search_path = public as $$
  with x as (
    select coalesce(i.cert_type, '일반') cert, i.id item, ol.qty, ol.qty * ol.sale_price amt
    from public.order_lines ol join public.items i on i.id = ol.item_id
    where app.is_staff(p_center_id) and ol.center_id = p_center_id and ol.delivery_date between p_from and p_to and ol.status not in ('draft','canceled'))
  select cert, count(distinct item), sum(qty), round(sum(amt)), round(100.0 * sum(amt) / nullif((select sum(amt) from x), 0), 1)
  from x group by cert order by 4 desc
$$;

create or replace function public.report_po_status(p_center_id uuid, p_from date, p_to date)
returns table (납품일 date, 공급업체 text, 발주번호 text, 상품 text, 발주수량 numeric, 업체회신 numeric, 입고수량 numeric, 상태 text)
language sql stable security definer set search_path = public as $$
  select po.delivery_date, sp.name, po.po_no, i.name, pl.qty, pl.ack_qty, pl.received_qty,
         case po.status when 'issued' then '발주' when 'acknowledged' then '업체확인' when 'received' then '입고완료' else '취소' end
  from public.purchase_orders po join public.po_lines pl on pl.po_id = po.id
  join public.suppliers sp on sp.id = po.supplier_id join public.items i on i.id = pl.item_id
  where app.is_staff(p_center_id) and po.center_id = p_center_id and po.delivery_date between p_from and p_to
  order by 1, 2, 4
$$;

create or replace function public.report_claims(p_center_id uuid, p_from date, p_to date)
returns table (학교 text, 유형 text, 건수 bigint, 미결 bigint, 처리중 bigint, 완료 bigint)
language sql stable security definer set search_path = public as $$
  select s.name, c.type, count(*), count(*) filter (where c.status = 'open'), count(*) filter (where c.status = 'in_progress'), count(*) filter (where c.status = 'closed')
  from public.claims c join public.schools s on s.id = c.school_id
  where app.is_staff(p_center_id) and c.center_id = p_center_id and c.claim_date between p_from and p_to
  group by 1, 2 order by 1, 2
$$;

create or replace function public.report_subsidy(p_center_id uuid, p_from date, p_to date)
returns table (학교 text, 월 text, 보조금유형 text, 배정액 numeric, 사용액 numeric, 잔액 numeric, 집행률 numeric)
language sql stable security definer set search_path = public as $$
  with u as (
    select ol.school_id, to_char(ol.delivery_date, 'YYYY-MM') m, i.subsidy_type t, sum(round(ol.qty * ol.sale_price)) used
    from public.order_lines ol join public.items i on i.id = ol.item_id
    where ol.center_id = p_center_id and ol.delivery_date between p_from and p_to and ol.status in ('shipped','delivered') and i.subsidy_type is not null
    group by 1, 2, 3)
  select s.name, b.month, b.subsidy_type, b.amount, coalesce(u.used, 0), b.amount - coalesce(u.used, 0),
         round(100.0 * coalesce(u.used, 0) / nullif(b.amount, 0), 1)
  from public.subsidy_monthly b join public.schools s on s.id = b.school_id
  left join u on u.school_id = b.school_id and u.m = b.month and u.t = b.subsidy_type
  where app.is_staff(p_center_id) and b.center_id = p_center_id and b.month between to_char(p_from, 'YYYY-MM') and to_char(p_to, 'YYYY-MM')
  order by 1, 2, 3
$$;

create or replace function public.report_subsidy_year(p_center_id uuid, p_from date, p_to date)
returns table (학교 text, 연도 integer, 보조금유형 text, 연간예산 numeric, 월배정합계 numeric, 정산액 numeric, 집행률 numeric)
language sql stable security definer set search_path = public as $$
  select s.name, b.year, b.subsidy_type, b.amount,
         (select coalesce(sum(amount), 0) from public.subsidy_monthly m where m.school_id = b.school_id and m.subsidy_type = b.subsidy_type and m.month like b.year || '-%'),
         (select coalesce(sum(settled_amount), 0) from public.subsidy_settlements x where x.school_id = b.school_id and x.subsidy_type = b.subsidy_type and x.month like b.year || '-%'),
         round(100.0 * (select coalesce(sum(settled_amount), 0) from public.subsidy_settlements x where x.school_id = b.school_id and x.subsidy_type = b.subsidy_type and x.month like b.year || '-%') / nullif(b.amount, 0), 1)
  from public.subsidy_budgets b join public.schools s on s.id = b.school_id
  where app.is_staff(p_center_id) and b.center_id = p_center_id and b.year between extract(year from p_from)::int and extract(year from p_to)::int
  order by 1, 3
$$;

create or replace function public.report_stock(p_center_id uuid, p_from date, p_to date)
returns table (상품코드 text, 상품명 text, 단위 text, 기초재고 numeric, 입고 numeric, 출고 numeric, 기말재고 numeric)
language sql stable security definer set search_path = public as $$
  select i.code, i.name, i.unit,
         coalesce(sum(m.qty) filter (where m.move_date < p_from), 0),
         coalesce(sum(m.qty) filter (where m.move_date between p_from and p_to and m.qty > 0), 0),
         coalesce(-sum(m.qty) filter (where m.move_date between p_from and p_to and m.qty < 0), 0),
         coalesce(sum(m.qty) filter (where m.move_date <= p_to), 0)
  from public.stock_moves m join public.items i on i.id = m.item_id
  where app.is_staff(p_center_id) and m.center_id = p_center_id
  group by i.code, i.name, i.unit order by 1
$$;

create or replace function public.report_cert_check(p_center_id uuid, p_from date, p_to date)
returns table (상품 text, 공급업체 text, 표시인증 text, 등록인증번호 text, 유효기간 text, 상태 text)
language sql stable security definer set search_path = public as $$
  select i.name, sp.name, i.cert_type, c.cert_no,
         case when c.id is null then null else c.valid_from || ' ~ ' || c.valid_to end,
         case when c.id is null then '인증정보 없음' when c.valid_to < p_to then '기간 만료' when c.valid_to < p_to + 30 then '30일 내 만료' else '정상' end
  from public.items i left join public.suppliers sp on sp.id = i.supplier_id
  left join lateral (
    select * from public.certifications c where c.center_id = i.center_id and (c.item_id = i.id or (c.item_id is null and c.supplier_id = i.supplier_id))
    order by c.valid_to desc limit 1) c on true
  where app.is_staff(p_center_id) and i.center_id = p_center_id and i.active and coalesce(i.cert_type, '일반') not in ('일반', '')
  order by 6 desc, 1
$$;

create or replace function public.report_trace(p_center_id uuid, p_from date, p_to date)
returns table (로트번호 text, 입고일 date, 상품 text, 공급업체 text, 생산자 text, 인증 text, 안전성검사 text, 납품학교 text)
language sql stable security definer set search_path = public as $$
  select l.lot_no, l.received_date, i.name, sp.name,
         (select string_agg(p.name, ', ') from public.producers p where p.supplier_id = l.supplier_id),
         coalesce(l.cert_type, '') || coalesce(' ' || l.cert_no, ''),
         (select string_agg(t.test_type || ':' || t.result, ', ') from public.safety_tests t where t.lot_id = l.id),
         (select string_agg(distinct s.name, ', ') from public.order_lines ol join public.schools s on s.id = ol.school_id where ol.lot_id = l.id)
  from public.lots l join public.items i on i.id = l.item_id left join public.suppliers sp on sp.id = l.supplier_id
  where app.is_staff(p_center_id) and l.center_id = p_center_id and l.received_date between p_from and p_to
  order by 2 desc, 1
$$;

create or replace function public.report_std_items(p_center_id uuid, p_from date, p_to date)
returns table (상품코드 text, 상품명 text, 규격 text, NEIS식재료코드 text, NEIS식품명 text, 표준속성 text, 등록상태 text)
language sql stable security definer set search_path = public as $$
  select i.code, i.name, i.spec, i.neis_food_code, n.name, i.std_attr,
         case when i.neis_food_code is null then '미매칭' when n.id is null then '코드 오류' else '매칭완료' end
  from public.items i left join public.neis_foods n on n.center_id = i.center_id and n.code = i.neis_food_code
  where app.is_staff(p_center_id) and i.center_id = p_center_id
  order by 7 desc, 1
$$;

create or replace function public.report_trades(p_center_id uuid, p_from date, p_to date)
returns table (거래일 date, 구분 text, 상대센터 text, 상품 text, 수량 numeric, 단가 numeric, 금액 numeric, 상태 text)
language sql stable security definer set search_path = public as $$
  select t.trade_date, case when t.buyer_center_id = p_center_id then '매입' else '매출' end,
         case when t.buyer_center_id = p_center_id then sc.name else bc.name end,
         i.name, t.qty, t.price, round(t.qty * t.price), t.status
  from public.center_trades t join public.shared_items si on si.id = t.shared_item_id join public.items i on i.id = si.item_id
  join public.centers bc on bc.id = t.buyer_center_id join public.centers sc on sc.id = t.seller_center_id
  where app.is_staff(p_center_id) and (t.buyer_center_id = p_center_id or t.seller_center_id = p_center_id) and t.trade_date between p_from and p_to
  order by 1 desc
$$;

grant execute on all functions in schema public to authenticated;

-- 센터 간 거래: 다른 센터의 공유상품 목록 (상품명 등은 판매 센터 소유라 함수로 제공)
create or replace function public.shared_market(p_center_id uuid)
returns table (id uuid, 판매센터 text, 상품 text, 규격 text, 단위 text, 공유단가 numeric, 공급시작 date, 공급종료 date, 최소수량 numeric, 비고 text)
language sql stable security definer set search_path = public as $$
  select si.id, c.name, i.name, i.spec, i.unit, si.share_price, si.available_from, si.available_to, si.min_qty, si.note
  from public.shared_items si join public.items i on i.id = si.item_id join public.centers c on c.id = si.center_id
  where app.is_staff(p_center_id) and si.center_id <> p_center_id
    and (si.available_to is null or si.available_to >= current_date)
  order by c.name, i.name
$$;

create or replace function public.request_trade(p_center_id uuid, p_shared_id uuid, p_date date, p_qty numeric, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare si public.shared_items; v uuid;
begin
  if not app.is_staff(p_center_id) then raise exception '권한이 없습니다'; end if;
  select * into si from public.shared_items where id = p_shared_id;
  if si.id is null then raise exception '공유상품을 찾을 수 없습니다'; end if;
  if si.center_id = p_center_id then raise exception '자기 센터 상품은 요청할 수 없습니다'; end if;
  if si.min_qty is not null and p_qty < si.min_qty then raise exception '최소 주문수량은 %입니다', si.min_qty; end if;
  insert into public.center_trades(buyer_center_id, seller_center_id, shared_item_id, trade_date, qty, price, note)
  values (p_center_id, si.center_id, si.id, p_date, p_qty, si.share_price, p_note) returning id into v;
  return v;
end $$;

grant execute on all functions in schema public to authenticated;
