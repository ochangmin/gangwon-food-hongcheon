-- 강원 먹거리 이음: Supabase 한 번에 설치

-- Supabase 대시보드 > SQL Editor > New query 에 이 파일 전체를 붙여넣고 Run

-- 새 프로젝트에서 한 번만 실행하세요.



-- ===== 20261106000100_schema.sql =====

-- 강원 먹거리 이음 · 학교급식 수발주 플랫폼
-- 0001: 기본 스키마 (멀티 센터)
-- 업무 흐름: 학교 주문(draft→submitted) → 센터 확정(confirmed, 업체별 발주 자동생성)
--            → 입고(received, 로트 부여) → 출고(shipped, 거래명세서) → 배송/검수(delivered)

create extension if not exists pgcrypto;

create schema if not exists app;

create type public.app_role     as enum ('province_admin','center_admin','school','supplier');
create type public.line_status  as enum ('draft','submitted','confirmed','received','shipped','delivered','canceled');
create type public.po_status    as enum ('issued','acknowledged','received','canceled');
create type public.tax_type     as enum ('exempt','taxable');
create type public.storage_type as enum ('ambient','chilled','frozen');
create type public.claim_status as enum ('open','in_progress','closed');
create type public.run_status   as enum ('waiting','departed','arrived');

-- 시군 학교급식지원센터
create table public.centers (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[A-Z0-9]{2,8}$'),   -- 로트·전표 번호 접두어 (예: HC)
  name        text not null,
  sigungu     text not null,                                         -- 시군 (예: 홍천군)
  address     text,
  tel         text,
  biz_no      text,
  created_at  timestamptz not null default now()
);

create table public.courses (
  id           uuid primary key default gen_random_uuid(),
  center_id    uuid not null references public.centers(id) on delete cascade,
  code         text not null,
  name         text not null,
  vehicle_no   text,
  driver_name  text,
  driver_phone text,
  depart_time  time,
  active       boolean not null default true,
  unique (center_id, code)
);

create table public.schools (
  id             uuid primary key default gen_random_uuid(),
  center_id      uuid not null references public.centers(id) on delete cascade,
  code           text not null,                 -- 납품처코드
  name           text not null,
  neis_code      text,                          -- NEIS 학교코드
  school_level   text,                          -- 초/중/고/특수/유치원
  meals          integer not null default 0,    -- 1식 기준 급식 인원
  address        text,
  course_id      uuid references public.courses(id) on delete set null,
  delivery_seq   integer,
  active         boolean not null default true,
  external_ref   text,                          -- umji:CUST_SEQ
  unique (center_id, code)
);
create unique index schools_ext on public.schools(center_id, external_ref) where external_ref is not null;

create table public.suppliers (
  id            uuid primary key default gen_random_uuid(),
  center_id     uuid not null references public.centers(id) on delete cascade,
  code          text not null,
  name          text not null,
  kind          text,                            -- 농산물/축산물/수산물/가공품
  biz_no        text,
  area          text,
  phone         text,
  active        boolean not null default true,
  external_ref  text,
  unique (center_id, code)
);
create unique index suppliers_ext on public.suppliers(center_id, external_ref) where external_ref is not null;

create table public.items (
  id              uuid primary key default gen_random_uuid(),
  center_id       uuid not null references public.centers(id) on delete cascade,
  code            text not null check (code ~ '^[A-Za-z0-9_-]{1,20}$'),
  name            text not null,
  spec            text,
  unit            text not null default 'kg',
  tax             public.tax_type not null default 'exempt',
  supplier_id     uuid references public.suppliers(id) on delete set null,
  category        text,                           -- 채소/육류/가공 등
  cert_type       text,                           -- 유기농/무농약/GAP/무항생제/동물복지/일반
  cert_no         text,
  origin          text not null default '국내산',
  origin_detail   text,                           -- 강원 홍천 등
  storage         public.storage_type not null default 'chilled',
  neis_food_name  text,
  active          boolean not null default true,
  external_ref    text,
  unique (center_id, code)
);
create unique index items_ext on public.items(center_id, external_ref) where external_ref is not null;

-- 기간별 단가 (판매가 = 학교 납품가, 매입가 = 공급업체 매입가)
create table public.item_prices (
  id              uuid primary key default gen_random_uuid(),
  item_id         uuid not null references public.items(id) on delete cascade,
  sale_price      numeric(12,2) not null check (sale_price >= 0),
  purchase_price  numeric(12,2) not null check (purchase_price >= 0),
  valid_from      date not null,
  valid_to        date not null default '9999-12-31',
  check (valid_from <= valid_to)
);
create index item_prices_item on public.item_prices(item_id, valid_from desc);

create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  name         text not null,
  role         public.app_role not null,
  center_id    uuid references public.centers(id) on delete cascade,
  school_id    uuid references public.schools(id) on delete cascade,
  supplier_id  uuid references public.suppliers(id) on delete cascade,
  phone        text,
  created_at   timestamptz not null default now(),
  check (
    (role = 'province_admin') or
    (role = 'center_admin' and center_id is not null) or
    (role = 'school'       and center_id is not null and school_id is not null) or
    (role = 'supplier'     and center_id is not null and supplier_id is not null)
  )
);

-- 주문 헤더: 학교 × 납품일 × 급식구분
create table public.orders (
  id             uuid primary key default gen_random_uuid(),
  center_id      uuid not null references public.centers(id) on delete cascade,
  school_id      uuid not null references public.schools(id) on delete cascade,
  delivery_date  date not null,
  meal_type      text not null default '중식',
  order_no       text not null,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  external_ref   text,
  unique (school_id, delivery_date, meal_type)
);
create index orders_center_date on public.orders(center_id, delivery_date);

create table public.purchase_orders (
  id               uuid primary key default gen_random_uuid(),
  center_id        uuid not null references public.centers(id) on delete cascade,
  supplier_id      uuid not null references public.suppliers(id) on delete cascade,
  delivery_date    date not null,
  po_no            text not null,
  status           public.po_status not null default 'issued',
  acknowledged_at  timestamptz,
  received_at      timestamptz,
  created_at       timestamptz not null default now(),
  unique (supplier_id, delivery_date)
);
create index po_center_date on public.purchase_orders(center_id, delivery_date);

create table public.po_lines (
  id              uuid primary key default gen_random_uuid(),
  po_id           uuid not null references public.purchase_orders(id) on delete cascade,
  center_id       uuid not null references public.centers(id) on delete cascade,
  supplier_id     uuid not null references public.suppliers(id) on delete cascade,
  item_id         uuid not null references public.items(id),
  qty             numeric(12,2) not null default 0,
  purchase_price  numeric(12,2) not null default 0,
  ack_qty         numeric(12,2),
  received_qty    numeric(12,2),
  unique (po_id, item_id)
);

create table public.lots (
  id             uuid primary key default gen_random_uuid(),
  center_id      uuid not null references public.centers(id) on delete cascade,
  lot_no         text not null,
  item_id        uuid not null references public.items(id),
  supplier_id    uuid references public.suppliers(id),
  po_line_id     uuid references public.po_lines(id) on delete set null,
  received_date  date not null,
  received_qty   numeric(12,2) not null,
  storage        public.storage_type not null,
  cert_type      text,
  cert_no        text,
  origin         text,
  origin_detail  text,
  created_at     timestamptz not null default now(),
  unique (center_id, lot_no)
);

create table public.order_lines (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders(id) on delete cascade,
  center_id       uuid not null references public.centers(id) on delete cascade,
  school_id       uuid not null references public.schools(id) on delete cascade,
  delivery_date   date not null,
  item_id         uuid not null references public.items(id),
  qty             numeric(12,2) not null check (qty > 0),
  sale_price      numeric(12,2) not null default 0,
  purchase_price  numeric(12,2) not null default 0,
  status          public.line_status not null default 'draft',
  po_line_id      uuid references public.po_lines(id) on delete set null,
  lot_id          uuid references public.lots(id) on delete set null,
  shipment_id     uuid,
  note            text,
  external_ref    text,
  updated_at      timestamptz not null default now(),
  unique (order_id, item_id)
);
create index order_lines_center_date on public.order_lines(center_id, delivery_date, status);
create index order_lines_school_date on public.order_lines(school_id, delivery_date);

-- 출고(거래명세서) : 학교 × 납품일
create table public.shipments (
  id             uuid primary key default gen_random_uuid(),
  center_id      uuid not null references public.centers(id) on delete cascade,
  school_id      uuid not null references public.schools(id) on delete cascade,
  delivery_date  date not null,
  statement_no   text not null,
  course_id      uuid references public.courses(id) on delete set null,
  shipped_at     timestamptz not null default now(),
  delivered_at   timestamptz,
  received_by    text,                -- 검수자
  unique (school_id, delivery_date)
);
alter table public.order_lines
  add constraint order_lines_shipment_fk foreign key (shipment_id) references public.shipments(id) on delete set null;

create table public.course_runs (
  id           uuid primary key default gen_random_uuid(),
  center_id    uuid not null references public.centers(id) on delete cascade,
  course_id    uuid not null references public.courses(id) on delete cascade,
  run_date     date not null,
  status       public.run_status not null default 'waiting',
  departed_at  timestamptz,
  arrived_at   timestamptz,
  unique (course_id, run_date)
);

create table public.claims (
  id             uuid primary key default gen_random_uuid(),
  center_id      uuid not null references public.centers(id) on delete cascade,
  school_id      uuid not null references public.schools(id) on delete cascade,
  claim_no       text not null,
  claim_date     date not null default current_date,
  item_id        uuid not null references public.items(id),
  order_line_id  uuid references public.order_lines(id) on delete set null,
  lot_id         uuid references public.lots(id) on delete set null,
  type           text not null check (type in ('품질불량','수량부족','이물질','오배송','배송지연','온도이탈','기타')),
  qty            numeric(12,2) not null default 0,
  description    text,
  action         text check (action in ('교환','반품','감액','추가배송','주의조치')),
  status         public.claim_status not null default 'open',
  created_by     uuid,
  created_at     timestamptz not null default now(),
  unique (center_id, claim_no)
);

-- umji 병행 운영: 수집 원본 적재 → 매핑
create table public.umji_sync_runs (
  id           uuid primary key default gen_random_uuid(),
  center_id    uuid not null references public.centers(id) on delete cascade,
  source       text not null default 'collector',
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  row_count    integer not null default 0,
  mapped_count integer not null default 0,
  status       text not null default 'loaded' check (status in ('loaded','mapped','failed')),
  message      text
);

create table public.umji_staging (
  id         bigserial primary key,
  run_id     uuid not null references public.umji_sync_runs(id) on delete cascade,
  center_id  uuid not null references public.centers(id) on delete cascade,
  dataset    text not null check (dataset in ('schools','suppliers','items','shipments')),
  payload    jsonb not null,
  mapped     boolean not null default false,
  error      text
);
create index umji_staging_run on public.umji_staging(run_id, dataset);

create table public.audit_log (
  id         bigserial primary key,
  center_id  uuid,
  actor      uuid,
  action     text not null,
  target     text,
  detail     jsonb,
  at         timestamptz not null default now()
);
create index audit_center_at on public.audit_log(center_id, at desc);


-- ===== 20261106000200_rls.sql =====

-- 0002: 역할별 행 단위 권한 (RLS)
-- 도 관리자: 전체 / 센터 관리자: 자기 센터 / 학교: 자기 학교 주문·출고·클레임 / 공급업체: 자기 발주·로트

create or replace function app.me() returns public.profiles
language sql stable security definer set search_path = public as $$
  select * from public.profiles where id = auth.uid()
$$;

create or replace function app.role() returns public.app_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function app.center() returns uuid
language sql stable security definer set search_path = public as $$
  select center_id from public.profiles where id = auth.uid()
$$;

create or replace function app.school() returns uuid
language sql stable security definer set search_path = public as $$
  select school_id from public.profiles where id = auth.uid()
$$;

create or replace function app.supplier() returns uuid
language sql stable security definer set search_path = public as $$
  select supplier_id from public.profiles where id = auth.uid()
$$;

-- 해당 센터 데이터를 관리할 수 있는가 (도 관리자 또는 그 센터 관리자)
create or replace function app.is_staff(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.role = 'province_admin' or (p.role = 'center_admin' and p.center_id = c))
  )
$$;

-- 해당 센터 소속인가 (기준정보 열람용)
create or replace function app.in_center(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and (p.role = 'province_admin' or p.center_id = c)
  )
$$;

grant usage on schema public to authenticated;
grant usage on schema app to authenticated;
grant execute on all functions in schema app to authenticated;

alter table public.centers         enable row level security;
alter table public.courses         enable row level security;
alter table public.schools         enable row level security;
alter table public.suppliers       enable row level security;
alter table public.items           enable row level security;
alter table public.item_prices     enable row level security;
alter table public.profiles        enable row level security;
alter table public.orders          enable row level security;
alter table public.order_lines     enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.po_lines        enable row level security;
alter table public.lots            enable row level security;
alter table public.shipments       enable row level security;
alter table public.course_runs     enable row level security;
alter table public.claims          enable row level security;
alter table public.umji_sync_runs  enable row level security;
alter table public.umji_staging    enable row level security;
alter table public.audit_log       enable row level security;

-- centers
create policy centers_read  on public.centers for select using (app.in_center(id));
create policy centers_write on public.centers for all using (app.role() = 'province_admin') with check (app.role() = 'province_admin');

-- 기준정보: 센터 소속이면 열람, 관리자만 수정
create policy courses_read   on public.courses   for select using (app.is_staff(center_id));
create policy courses_write  on public.courses   for all using (app.is_staff(center_id)) with check (app.is_staff(center_id));

create policy schools_read   on public.schools   for select using (app.is_staff(center_id) or id = app.school());
create policy schools_write  on public.schools   for all using (app.is_staff(center_id)) with check (app.is_staff(center_id));

create policy suppliers_read  on public.suppliers for select using (app.in_center(center_id));
create policy suppliers_write on public.suppliers for all using (app.is_staff(center_id)) with check (app.is_staff(center_id));

create policy items_read   on public.items for select using (app.in_center(center_id));
create policy items_write  on public.items for all using (app.is_staff(center_id)) with check (app.is_staff(center_id));

create policy prices_read  on public.item_prices for select
  using (exists (select 1 from public.items i where i.id = item_id and app.in_center(i.center_id)));
create policy prices_write on public.item_prices for all
  using (exists (select 1 from public.items i where i.id = item_id and app.is_staff(i.center_id)))
  with check (exists (select 1 from public.items i where i.id = item_id and app.is_staff(i.center_id)));

-- profiles: 본인 + 센터 관리자. 계정 생성·역할 변경은 관리자만, 관리자 권한 부여는 도 관리자만
create policy profiles_read on public.profiles for select
  using (id = auth.uid() or app.role() = 'province_admin' or (center_id is not null and app.is_staff(center_id)));
create policy profiles_write on public.profiles for all
  using (app.role() = 'province_admin' or (app.role() = 'center_admin' and center_id = app.center() and role in ('school','supplier')))
  with check (app.role() = 'province_admin' or (app.role() = 'center_admin' and center_id = app.center() and role in ('school','supplier')));

-- 주문: 학교는 자기 학교의 작성중/제출 상태만 직접 수정. 확정 이후는 업무 함수로만 변경
create policy orders_read on public.orders for select
  using (app.is_staff(center_id) or school_id = app.school());
create policy orders_write_staff on public.orders for all
  using (app.is_staff(center_id)) with check (app.is_staff(center_id));
create policy orders_write_school on public.orders for insert
  with check (school_id = app.school() and center_id = app.center());

create policy lines_read on public.order_lines for select
  using (app.is_staff(center_id) or school_id = app.school());
create policy lines_staff on public.order_lines for all
  using (app.is_staff(center_id)) with check (app.is_staff(center_id));
create policy lines_school_ins on public.order_lines for insert
  with check (school_id = app.school() and status in ('draft','submitted'));
create policy lines_school_upd on public.order_lines for update
  using (school_id = app.school() and status in ('draft','submitted'))
  with check (school_id = app.school() and status in ('draft','submitted'));
create policy lines_school_del on public.order_lines for delete
  using (school_id = app.school() and status in ('draft','submitted'));

-- 발주: 공급업체는 자기 발주 열람 (수량 회신은 ack_po 함수로)
create policy po_read on public.purchase_orders for select
  using (app.is_staff(center_id) or supplier_id = app.supplier());
create policy po_staff on public.purchase_orders for all
  using (app.is_staff(center_id)) with check (app.is_staff(center_id));
create policy pol_read on public.po_lines for select
  using (app.is_staff(center_id) or supplier_id = app.supplier());
create policy pol_staff on public.po_lines for all
  using (app.is_staff(center_id)) with check (app.is_staff(center_id));

-- 로트: 관리자, 해당 공급업체, 그 로트를 납품받은 학교
create policy lots_read on public.lots for select using (
  app.is_staff(center_id) or supplier_id = app.supplier()
  or exists (select 1 from public.order_lines l where l.lot_id = lots.id and l.school_id = app.school())
);
create policy lots_staff on public.lots for all using (app.is_staff(center_id)) with check (app.is_staff(center_id));

create policy ship_read on public.shipments for select using (app.is_staff(center_id) or school_id = app.school());
create policy ship_staff on public.shipments for all using (app.is_staff(center_id)) with check (app.is_staff(center_id));

create policy runs_staff on public.course_runs for all using (app.is_staff(center_id)) with check (app.is_staff(center_id));

create policy claims_read on public.claims for select using (app.is_staff(center_id) or school_id = app.school());
create policy claims_staff on public.claims for all using (app.is_staff(center_id)) with check (app.is_staff(center_id));

create policy umji_runs_staff on public.umji_sync_runs for all using (app.is_staff(center_id)) with check (app.is_staff(center_id));
create policy umji_stage_staff on public.umji_staging for all using (app.is_staff(center_id)) with check (app.is_staff(center_id));

create policy audit_read on public.audit_log for select using (center_id is not null and app.is_staff(center_id));

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;


-- ===== 20261106000300_workflow.sql =====

-- 0003: 업무 흐름 함수와 무결성 트리거
-- 확정 이후의 상태 변경은 아래 함수로만 가능 (함수 안에서 app.rpc 플래그를 켬)

create or replace function app.rpc_on() returns void language sql as $$
  select set_config('app.rpc','1',true)
$$;
create or replace function app.in_rpc() returns boolean language sql stable as $$
  select coalesce(current_setting('app.rpc', true), '') = '1'
$$;

create or replace function app.log(p_center uuid, p_action text, p_target text, p_detail jsonb default null)
returns void language sql security definer set search_path = public as $$
  insert into public.audit_log(center_id, actor, action, target, detail) values (p_center, auth.uid(), p_action, p_target, p_detail)
$$;

create or replace function app.ymd(d date) returns text language sql immutable as $$ select to_char(d, 'YYMMDD') $$;

-- 납품일 기준 유효 단가
create or replace function public.price_on(p_item uuid, p_date date)
returns table (sale_price numeric, purchase_price numeric)
language sql stable security definer set search_path = public as $$
  select sale_price, purchase_price from public.item_prices
  where item_id = p_item and p_date between valid_from and valid_to
  order by valid_from desc limit 1
$$;

-- 주문 헤더: 센터·주문번호 자동 지정
create or replace function app.tg_orders() returns trigger
language plpgsql security definer set search_path = public as $$
declare s public.schools;
begin
  select * into s from public.schools where id = new.school_id;
  if s.id is null then raise exception '학교를 찾을 수 없습니다'; end if;
  new.center_id := s.center_id;
  if new.order_no is null or new.order_no = '' then
    new.order_no := 'OR' || app.ymd(new.delivery_date) || '-' || s.code || case when new.meal_type <> '중식' then '-' || new.meal_type else '' end;
  end if;
  return new;
end $$;
create trigger orders_bi before insert on public.orders for each row execute function app.tg_orders();

-- 주문 라인: 비정규화 필드, 단가 자동 적용, 확정 이후 직접 수정 차단
create or replace function app.tg_order_lines() returns trigger
language plpgsql security definer set search_path = public as $$
declare o public.orders; it public.items; pr record;
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

  if new.status in ('draft','submitted') then
    if not it.active then raise exception '% 상품은 사용 중지되었습니다', it.name; end if;
    select * into pr from public.price_on(new.item_id, o.delivery_date);
    if pr.sale_price is null then
      raise exception '% 상품의 % 납품 단가가 등록되지 않았습니다', it.name, o.delivery_date;
    end if;
    new.sale_price := pr.sale_price;
    new.purchase_price := pr.purchase_price;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger order_lines_biu before insert or update on public.order_lines for each row execute function app.tg_order_lines();

create or replace function app.tg_order_lines_del() returns trigger
language plpgsql as $$
begin
  if not app.in_rpc() and old.status not in ('draft','submitted') then
    raise exception '확정된 주문은 삭제할 수 없습니다. 확정취소 후 삭제하세요';
  end if;
  return old;
end $$;
create trigger order_lines_bd before delete on public.order_lines for each row execute function app.tg_order_lines_del();

------------------------------------------------------------------------------
-- 1. 학교 주문 저장/제출
--    p_lines: [{"item_id": "...", "qty": 12.5}, ...]  qty 0 이하는 삭제
------------------------------------------------------------------------------
create or replace function public.save_order(
  p_school_id uuid, p_date date, p_lines jsonb, p_submit boolean default false, p_meal text default '중식')
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.schools; v_order uuid; e jsonb; v_qty numeric; v_item uuid; v_saved int := 0; v_locked int := 0; cur public.order_lines;
begin
  select * into s from public.schools where id = p_school_id;
  if s.id is null then raise exception '학교를 찾을 수 없습니다'; end if;
  if not (app.school() is not distinct from p_school_id or app.is_staff(s.center_id)) then raise exception '권한이 없습니다'; end if;
  if app.role() = 'school' and p_date <= current_date then
    raise exception '납품일 당일·지난 주문은 학교에서 수정할 수 없습니다. 센터에 문의하세요';
  end if;

  insert into public.orders(center_id, school_id, delivery_date, meal_type, order_no, created_by)
  values (s.center_id, p_school_id, p_date, coalesce(p_meal,'중식'), '', auth.uid())
  on conflict (school_id, delivery_date, meal_type) do update set meal_type = excluded.meal_type
  returning id into v_order;

  for e in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_item := (e->>'item_id')::uuid;
    v_qty  := coalesce((e->>'qty')::numeric, 0);
    select * into cur from public.order_lines where order_id = v_order and item_id = v_item;
    if cur.id is not null and cur.status not in ('draft','submitted') then
      v_locked := v_locked + 1; continue;
    end if;
    if v_qty <= 0 then
      if cur.id is not null then delete from public.order_lines where id = cur.id; v_saved := v_saved + 1; end if;
    elsif cur.id is null then
      insert into public.order_lines(order_id, center_id, school_id, delivery_date, item_id, qty, status)
      values (v_order, s.center_id, p_school_id, p_date, v_item, v_qty, case when p_submit then 'submitted' else 'draft' end::public.line_status);
      v_saved := v_saved + 1;
    else
      update public.order_lines set qty = v_qty where id = cur.id;
      v_saved := v_saved + 1;
    end if;
  end loop;

  if p_submit then
    update public.order_lines set status = 'submitted' where order_id = v_order and status = 'draft';
  end if;
  perform app.log(s.center_id, case when p_submit then 'order.submit' else 'order.save' end, v_order::text,
                  jsonb_build_object('saved', v_saved, 'locked', v_locked));
  return jsonb_build_object('order_id', v_order, 'saved', v_saved, 'locked', v_locked);
end $$;

------------------------------------------------------------------------------
-- 2. 센터 주문확정 → 공급업체별 발주 자동 생성/누적
------------------------------------------------------------------------------
create or replace function public.confirm_orders(p_center_id uuid, p_date date, p_school_ids uuid[] default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l record; v_po uuid; v_pol uuid; n int := 0; v_center public.centers; v_missing text;
begin
  if not app.is_staff(p_center_id) then raise exception '권한이 없습니다'; end if;
  perform app.rpc_on();
  select * into v_center from public.centers where id = p_center_id;

  select string_agg(distinct i.name, ', ') into v_missing
  from public.order_lines ol join public.items i on i.id = ol.item_id
  where ol.center_id = p_center_id and ol.delivery_date = p_date and ol.status = 'submitted'
    and (p_school_ids is null or ol.school_id = any(p_school_ids)) and i.supplier_id is null;
  if v_missing is not null then raise exception '공급업체가 지정되지 않은 상품이 있습니다: %', v_missing; end if;

  for l in
    select ol.*, i.supplier_id as sup_id, sp.code as sup_code
    from public.order_lines ol
    join public.items i on i.id = ol.item_id
    join public.suppliers sp on sp.id = i.supplier_id
    where ol.center_id = p_center_id and ol.delivery_date = p_date and ol.status = 'submitted'
      and (p_school_ids is null or ol.school_id = any(p_school_ids))
    for update of ol
  loop
    insert into public.purchase_orders(center_id, supplier_id, delivery_date, po_no)
    values (p_center_id, l.sup_id, p_date, 'PO' || app.ymd(p_date) || '-' || l.sup_code)
    on conflict (supplier_id, delivery_date) do update
      set status = case when purchase_orders.status = 'canceled' then 'issued'::public.po_status
                        when purchase_orders.status = 'received' then 'issued'::public.po_status
                        else purchase_orders.status end
    returning id into v_po;

    insert into public.po_lines(po_id, center_id, supplier_id, item_id, qty, purchase_price)
    values (v_po, p_center_id, l.sup_id, l.item_id, l.qty, l.purchase_price)
    on conflict (po_id, item_id) do update set qty = po_lines.qty + excluded.qty, ack_qty = null
    returning id into v_pol;

    update public.order_lines set status = 'confirmed', po_line_id = v_pol where id = l.id;
    n := n + 1;
  end loop;

  perform app.log(p_center_id, 'order.confirm', p_date::text, jsonb_build_object('lines', n, 'schools', p_school_ids));
  return jsonb_build_object('confirmed', n);
end $$;

-- 확정취소 (입고 전만)
create or replace function public.unconfirm_lines(p_line_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.order_lines; n int := 0;
begin
  perform app.rpc_on();
  for l in select * from public.order_lines where id = any(p_line_ids) and status = 'confirmed' for update loop
    if not app.is_staff(l.center_id) then raise exception '권한이 없습니다'; end if;
    update public.po_lines set qty = qty - l.qty, ack_qty = null where id = l.po_line_id;
    update public.order_lines set status = 'submitted', po_line_id = null where id = l.id;
    n := n + 1;
  end loop;
  delete from public.po_lines pl where pl.qty <= 0
    and not exists (select 1 from public.order_lines ol where ol.po_line_id = pl.id)
    and not exists (select 1 from public.lots lt where lt.po_line_id = pl.id);
  delete from public.purchase_orders po where not exists (select 1 from public.po_lines pl where pl.po_id = po.id);
  return jsonb_build_object('unconfirmed', n);
end $$;

------------------------------------------------------------------------------
-- 3. 공급업체 발주 확인(수량 회신)
--    p_lines: [{"item_id": "...", "ack_qty": 10}] 생략하면 발주수량 그대로 확인
------------------------------------------------------------------------------
create or replace function public.ack_po(p_po_id uuid, p_lines jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
declare po public.purchase_orders; e jsonb;
begin
  select * into po from public.purchase_orders where id = p_po_id;
  if po.id is null then raise exception '발주를 찾을 수 없습니다'; end if;
  if not (app.supplier() is not distinct from po.supplier_id or app.is_staff(po.center_id)) then raise exception '권한이 없습니다'; end if;
  if po.status not in ('issued','acknowledged') then raise exception '이미 입고 처리된 발주입니다'; end if;

  update public.po_lines set ack_qty = qty where po_id = p_po_id;
  if p_lines is not null then
    for e in select * from jsonb_array_elements(p_lines) loop
      update public.po_lines set ack_qty = (e->>'ack_qty')::numeric
      where po_id = p_po_id and item_id = (e->>'item_id')::uuid;
    end loop;
  end if;
  update public.purchase_orders set status = 'acknowledged', acknowledged_at = now() where id = p_po_id;
  perform app.log(po.center_id, 'po.ack', po.po_no, p_lines);
end $$;

------------------------------------------------------------------------------
-- 4. 입고 확정 → 로트 부여
--    p_lines: [{"item_id": "...", "received_qty": 10, "storage": "chilled"}]  생략 시 발주수량 전량 입고
------------------------------------------------------------------------------
create or replace function public.receive_po(p_po_id uuid, p_lines jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare po public.purchase_orders; c public.centers; pl record; e jsonb; v_rq numeric; v_st public.storage_type;
        v_lot uuid; v_lot_no text; v_pending numeric; n int := 0; shorts jsonb := '[]'::jsonb;
begin
  select * into po from public.purchase_orders where id = p_po_id for update;
  if po.id is null then raise exception '발주를 찾을 수 없습니다'; end if;
  if not app.is_staff(po.center_id) then raise exception '권한이 없습니다'; end if;
  perform app.rpc_on();
  select * into c from public.centers where id = po.center_id;

  for pl in
    select p.*, i.code as item_code, i.name as item_name, i.storage as item_storage, i.cert_type, i.cert_no, i.origin, i.origin_detail
    from public.po_lines p join public.items i on i.id = p.item_id where p.po_id = p_po_id
  loop
    select coalesce(sum(qty),0) into v_pending from public.order_lines where po_line_id = pl.id and status = 'confirmed';
    if v_pending = 0 then continue; end if;

    e := null;
    if p_lines is not null then
      select x into e from jsonb_array_elements(p_lines) x where (x->>'item_id')::uuid = pl.item_id limit 1;
    end if;
    v_rq := coalesce((e->>'received_qty')::numeric, v_pending);
    v_st := coalesce((e->>'storage')::public.storage_type, pl.item_storage);
    v_lot_no := c.code || '-' || app.ymd(po.delivery_date) || '-' || pl.item_code;

    insert into public.lots(center_id, lot_no, item_id, supplier_id, po_line_id, received_date, received_qty, storage,
                            cert_type, cert_no, origin, origin_detail)
    values (po.center_id, v_lot_no, pl.item_id, po.supplier_id, pl.id, po.delivery_date, v_rq, v_st,
            pl.cert_type, pl.cert_no, pl.origin, pl.origin_detail)
    on conflict (center_id, lot_no) do update set received_qty = lots.received_qty + excluded.received_qty, storage = excluded.storage
    returning id into v_lot;

    update public.po_lines set received_qty = coalesce(received_qty,0) + v_rq where id = pl.id;
    update public.order_lines set status = 'received', lot_id = v_lot where po_line_id = pl.id and status = 'confirmed';
    get diagnostics n = row_count;

    if v_rq < v_pending then
      shorts := shorts || jsonb_build_object('item', pl.item_name, 'ordered', v_pending, 'received', v_rq, 'lot_no', v_lot_no);
    end if;
  end loop;

  update public.purchase_orders set status = 'received', received_at = now()
  where id = p_po_id and not exists (
    select 1 from public.order_lines ol join public.po_lines p on p.id = ol.po_line_id
    where p.po_id = p_po_id and ol.status = 'confirmed');

  perform app.log(po.center_id, 'po.receive', po.po_no, jsonb_build_object('shortages', shorts));
  return jsonb_build_object('po_no', po.po_no, 'shortages', shorts);
end $$;

-- 입고취소 (출고 전만)
create or replace function public.undo_receive(p_po_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare po public.purchase_orders; n int;
begin
  select * into po from public.purchase_orders where id = p_po_id for update;
  if po.id is null or not app.is_staff(po.center_id) then raise exception '권한이 없습니다'; end if;
  if exists (select 1 from public.order_lines ol join public.po_lines p on p.id = ol.po_line_id
             where p.po_id = p_po_id and ol.status in ('shipped','delivered')) then
    raise exception '이미 출고된 품목이 있어 입고를 취소할 수 없습니다. 출고취소를 먼저 하세요';
  end if;
  perform app.rpc_on();
  update public.order_lines ol set status = 'confirmed', lot_id = null
  from public.po_lines p where p.id = ol.po_line_id and p.po_id = p_po_id and ol.status = 'received';
  get diagnostics n = row_count;
  delete from public.lots where po_line_id in (select id from public.po_lines where po_id = p_po_id);
  update public.po_lines set received_qty = null where po_id = p_po_id;
  update public.purchase_orders set status = case when acknowledged_at is not null then 'acknowledged' else 'issued' end::public.po_status,
         received_at = null where id = p_po_id;
  perform app.log(po.center_id, 'po.undo_receive', po.po_no, null);
  return jsonb_build_object('reverted', n);
end $$;

------------------------------------------------------------------------------
-- 5. 학교별 출고확정 → 거래명세서
------------------------------------------------------------------------------
create or replace function public.ship_school(p_school_id uuid, p_date date, p_line_ids uuid[] default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.schools; v_ship uuid; n int; v_wait int;
begin
  select * into s from public.schools where id = p_school_id;
  if s.id is null or not app.is_staff(s.center_id) then raise exception '권한이 없습니다'; end if;
  if not exists (select 1 from public.order_lines where school_id = p_school_id and delivery_date = p_date and status = 'received'
                 and (p_line_ids is null or id = any(p_line_ids))) then
    raise exception '출고할 입고완료 품목이 없습니다';
  end if;
  perform app.rpc_on();
  insert into public.shipments(center_id, school_id, delivery_date, statement_no, course_id)
  values (s.center_id, p_school_id, p_date, 'ST' || app.ymd(p_date) || '-' || s.code, s.course_id)
  on conflict (school_id, delivery_date) do update set course_id = excluded.course_id
  returning id into v_ship;
  update public.order_lines set status = 'shipped', shipment_id = v_ship
  where school_id = p_school_id and delivery_date = p_date and status = 'received'
    and (p_line_ids is null or id = any(p_line_ids));
  get diagnostics n = row_count;
  select count(*) into v_wait from public.order_lines where school_id = p_school_id and delivery_date = p_date and status in ('submitted','confirmed');
  perform app.log(s.center_id, 'ship', s.code || ' ' || p_date, jsonb_build_object('lines', n));
  return jsonb_build_object('shipment_id', v_ship, 'shipped', n, 'waiting', v_wait);
end $$;

create or replace function public.unship_lines(p_line_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.order_lines; n int := 0;
begin
  perform app.rpc_on();
  for l in select * from public.order_lines where id = any(p_line_ids) and status = 'shipped' for update loop
    if not app.is_staff(l.center_id) then raise exception '권한이 없습니다'; end if;
    update public.order_lines set status = 'received', shipment_id = null where id = l.id;
    n := n + 1;
  end loop;
  delete from public.shipments sh where not exists (select 1 from public.order_lines ol where ol.shipment_id = sh.id);
  return jsonb_build_object('unshipped', n);
end $$;

------------------------------------------------------------------------------
-- 6. 배송: 코스 출발/도착, 학교 검수확인
------------------------------------------------------------------------------
create or replace function public.course_run(p_course_id uuid, p_date date, p_action text)
returns public.run_status language plpgsql security definer set search_path = public as $$
declare co public.courses; r public.course_runs; n int;
begin
  select * into co from public.courses where id = p_course_id;
  if co.id is null or not app.is_staff(co.center_id) then raise exception '권한이 없습니다'; end if;
  perform app.rpc_on();
  insert into public.course_runs(center_id, course_id, run_date) values (co.center_id, p_course_id, p_date)
  on conflict (course_id, run_date) do nothing;
  if p_action = 'depart' then
    update public.course_runs set status = 'departed', departed_at = now() where course_id = p_course_id and run_date = p_date returning * into r;
  elsif p_action = 'arrive' then
    update public.course_runs set status = 'arrived', arrived_at = now(), departed_at = coalesce(departed_at, now())
    where course_id = p_course_id and run_date = p_date returning * into r;
    update public.shipments set delivered_at = coalesce(delivered_at, now())
    where delivery_date = p_date and school_id in (select id from public.schools where course_id = p_course_id);
    update public.order_lines set status = 'delivered'
    where delivery_date = p_date and status = 'shipped' and school_id in (select id from public.schools where course_id = p_course_id);
  elsif p_action = 'reset' then
    update public.course_runs set status = 'waiting', departed_at = null, arrived_at = null where course_id = p_course_id and run_date = p_date returning * into r;
  else
    raise exception '알 수 없는 동작: %', p_action;
  end if;
  return r.status;
end $$;

create or replace function public.confirm_receipt(p_shipment_id uuid, p_received_by text)
returns void language plpgsql security definer set search_path = public as $$
declare sh public.shipments;
begin
  select * into sh from public.shipments where id = p_shipment_id;
  if sh.id is null or not (app.school() is not distinct from sh.school_id or app.is_staff(sh.center_id)) then raise exception '권한이 없습니다'; end if;
  perform app.rpc_on();
  update public.shipments set delivered_at = coalesce(delivered_at, now()), received_by = p_received_by where id = p_shipment_id;
  update public.order_lines set status = 'delivered' where shipment_id = p_shipment_id and status = 'shipped';
  perform app.log(sh.center_id, 'receipt.confirm', sh.statement_no, jsonb_build_object('by', p_received_by));
end $$;

------------------------------------------------------------------------------
-- 7. 클레임 접수 (납품 이력에서 로트 자동 연결)
------------------------------------------------------------------------------
create or replace function public.create_claim(
  p_school_id uuid, p_item_id uuid, p_date date, p_type text, p_qty numeric, p_description text, p_action text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.schools; ol public.order_lines; v_no text; v_id uuid;
begin
  select * into s from public.schools where id = p_school_id;
  if s.id is null or not (app.school() is not distinct from p_school_id or app.is_staff(s.center_id)) then raise exception '권한이 없습니다'; end if;
  select * into ol from public.order_lines
  where school_id = p_school_id and item_id = p_item_id and delivery_date <= p_date and status in ('shipped','delivered','received')
  order by delivery_date desc limit 1;
  select 'CL' || app.ymd(p_date) || '-' || lpad((count(*) + 1)::text, 3, '0') into v_no
  from public.claims where center_id = s.center_id and claim_date = p_date;
  insert into public.claims(center_id, school_id, claim_no, claim_date, item_id, order_line_id, lot_id, type, qty, description, action, created_by)
  values (s.center_id, p_school_id, v_no, p_date, p_item_id, ol.id, ol.lot_id, p_type, coalesce(p_qty,0), p_description, p_action, auth.uid())
  returning id into v_id;
  perform app.log(s.center_id, 'claim.create', v_no, null);
  return jsonb_build_object('claim_id', v_id, 'claim_no', v_no, 'lot_id', ol.lot_id);
end $$;

------------------------------------------------------------------------------
-- 8. 현황 집계 (도: 전체 센터 / 센터: 자기 센터)
------------------------------------------------------------------------------
create or replace function public.day_summary(p_date date)
returns table (center_id uuid, center_name text, sigungu text, schools bigint, lines bigint,
               draft bigint, submitted bigint, confirmed bigint, received bigint, shipped bigint, delivered bigint,
               amount numeric, open_claims bigint)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.sigungu,
         count(distinct ol.school_id), count(ol.id),
         count(ol.id) filter (where ol.status = 'draft'),
         count(ol.id) filter (where ol.status = 'submitted'),
         count(ol.id) filter (where ol.status = 'confirmed'),
         count(ol.id) filter (where ol.status = 'received'),
         count(ol.id) filter (where ol.status = 'shipped'),
         count(ol.id) filter (where ol.status = 'delivered'),
         coalesce(sum(ol.qty * ol.sale_price) filter (where ol.status not in ('draft','canceled')), 0),
         (select count(*) from public.claims cl where cl.center_id = c.id and cl.status <> 'closed')
  from public.centers c
  left join public.order_lines ol on ol.center_id = c.id and ol.delivery_date = p_date
  where app.is_staff(c.id)
  group by c.id, c.name, c.sigungu
  order by c.sigungu
$$;

-- 거래명세서 라인 뷰 (RLS 적용: security_invoker)
create or replace view public.v_order_lines with (security_invoker = true) as
select ol.id, ol.order_id, ol.center_id, ol.school_id, s.code as school_code, s.name as school_name,
       ol.delivery_date, ol.item_id, i.code as item_code, i.name as item_name, i.spec, i.unit, i.tax,
       i.cert_type, i.origin, i.origin_detail, i.storage,
       i.supplier_id, sp.name as supplier_name,
       ol.qty, ol.sale_price, ol.purchase_price,
       round(ol.qty * ol.sale_price) as amount,
       case when i.tax = 'taxable' then round(ol.qty * ol.sale_price * 0.1) else 0 end as vat,
       ol.status, ol.lot_id, lt.lot_no, ol.shipment_id, ol.note
from public.order_lines ol
join public.schools s on s.id = ol.school_id
join public.items i on i.id = ol.item_id
left join public.suppliers sp on sp.id = i.supplier_id
left join public.lots lt on lt.id = ol.lot_id;

grant select on public.v_order_lines to authenticated;
grant execute on all functions in schema public to authenticated;


-- ===== 20261106000400_umji.sql =====

-- 0004: umji(강원 먹거리 통합운영시스템) 병행 운영 연계
-- 수집기가 umji 화면 데이터셋 행을 umji_staging에 JSON 그대로 적재 → umji_map()이 이음 테이블로 반영
-- 같은 행을 다시 적재해도 external_ref 기준으로 갱신되어 중복이 생기지 않음
--
-- 지원 데이터셋과 umji 컬럼 (umji 화면 분석, 2026-11-06)
--   schools   : CUST_SEQ, CUST_NM, CUST_CD?
--   suppliers : PU_CUST_SEQ?, PU_CUST_NM
--   items     : ITEM_SEQ, ITEM_NM, SPEC, UNIT_NM?, TAX_KIND, PRICE, PU_PRICE, CERT_NO, ORIGIN_PLACE?, PU_CUST_NM
--   shipments : 출고처리(SA020240) dsInv 행
--               INV_SEQ, INV_SERL, INV_DATE, DELV_DATE, CUST_SEQ, CUST_NM, ITEM_SEQ, ITEM_NM, SPEC, QTY, PRICE,
--               PU_PRICE, TAX_KIND, PU_CUST_NM, CERT_NO, LOT_NO?, PROG_STATUS

-- 서버 수집기(service_role 키)에서 호출 허용
create or replace function app.is_service() returns boolean language sql stable as $$
  select coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
      or coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role', '') = 'service_role'
$$;

create or replace function app.umji_date(v text) returns date language sql immutable as $$
  select case
    when v is null or v = '' then null
    when v ~ '^\d{8}$' then to_date(v, 'YYYYMMDD')
    when v ~ '^\d{4}-\d{2}-\d{2}' then substr(v,1,10)::date
    else null end
$$;

create or replace function app.umji_num(v text) returns numeric language sql immutable as $$
  select case when v ~ '^-?[0-9]+(\.[0-9]+)?$' then v::numeric else null end
$$;

create or replace function app.umji_school(p_center uuid, r jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_ref text := 'umji:' || (r->>'CUST_SEQ');
begin
  if r->>'CUST_SEQ' is null then raise exception 'CUST_SEQ 없음'; end if;
  insert into public.schools(center_id, code, name, external_ref)
  values (p_center, coalesce(nullif(r->>'CUST_CD',''), 'U' || (r->>'CUST_SEQ')), coalesce(r->>'CUST_NM', '학교 ' || (r->>'CUST_SEQ')), v_ref)
  on conflict (center_id, code) do update set name = excluded.name, external_ref = excluded.external_ref
  returning id into v_id;
  return v_id;
end $$;

create or replace function app.umji_supplier(p_center uuid, r jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_key text := coalesce(r->>'PU_CUST_SEQ', r->>'PU_CUST_NM');
begin
  if v_key is null then return null; end if;
  select id into v_id from public.suppliers where center_id = p_center and external_ref = 'umji:' || v_key;
  if v_id is not null then return v_id; end if;
  insert into public.suppliers(center_id, code, name, external_ref)
  values (p_center, 'U' || substr(md5(v_key), 1, 7), coalesce(r->>'PU_CUST_NM', v_key), 'umji:' || v_key)
  on conflict (center_id, code) do update set name = excluded.name
  returning id into v_id;
  return v_id;
end $$;

create or replace function app.umji_item(p_center uuid, r jsonb, p_date date) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_sup uuid; v_price numeric := app.umji_num(r->>'PRICE'); v_pu numeric := app.umji_num(r->>'PU_PRICE');
begin
  if r->>'ITEM_SEQ' is null then raise exception 'ITEM_SEQ 없음'; end if;
  v_sup := app.umji_supplier(p_center, r);
  insert into public.items(center_id, code, name, spec, unit, tax, supplier_id, cert_no, origin_detail, external_ref)
  values (p_center, 'U' || (r->>'ITEM_SEQ'), coalesce(r->>'ITEM_NM', '상품 ' || (r->>'ITEM_SEQ')), r->>'SPEC',
          coalesce(nullif(r->>'UNIT_NM',''), 'EA'),
          case when r->>'TAX_KIND' in ('1','과세','TAX') then 'taxable' else 'exempt' end::public.tax_type,
          v_sup, nullif(r->>'CERT_NO',''), nullif(r->>'ORIGIN_PLACE',''), 'umji:' || (r->>'ITEM_SEQ'))
  on conflict (center_id, code) do update
    set name = excluded.name, spec = excluded.spec, supplier_id = coalesce(excluded.supplier_id, items.supplier_id),
        cert_no = coalesce(excluded.cert_no, items.cert_no)
  returning id into v_id;
  if v_price is not null and p_date is not null and not exists (
       select 1 from public.item_prices where item_id = v_id and p_date between valid_from and valid_to) then
    insert into public.item_prices(item_id, sale_price, purchase_price, valid_from)
    values (v_id, v_price, coalesce(v_pu, v_price), p_date);
  end if;
  return v_id;
end $$;

create or replace function public.umji_map(p_run_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare run public.umji_sync_runs; st record; r jsonb; v_school uuid; v_item uuid; v_order uuid; v_date date;
        ok int := 0; bad int := 0; v_ref text;
begin
  select * into run from public.umji_sync_runs where id = p_run_id;
  if run.id is null or not (app.is_staff(run.center_id) or app.is_service()) then raise exception '권한이 없습니다'; end if;
  perform app.rpc_on();

  for st in select * from public.umji_staging where run_id = p_run_id and not mapped
            order by case dataset when 'schools' then 1 when 'suppliers' then 2 when 'items' then 3 else 4 end, id
  loop
    r := st.payload;
    begin
      if st.dataset = 'schools' then
        perform app.umji_school(run.center_id, r);
      elsif st.dataset = 'suppliers' then
        perform app.umji_supplier(run.center_id, r);
      elsif st.dataset = 'items' then
        perform app.umji_item(run.center_id, r, current_date);
      elsif st.dataset = 'shipments' then
        v_date := coalesce(app.umji_date(r->>'DELV_DATE'), app.umji_date(r->>'INV_DATE'));
        if v_date is null then raise exception '납품일 없음'; end if;
        v_school := app.umji_school(run.center_id, r);
        v_item := app.umji_item(run.center_id, r, v_date);
        insert into public.orders(center_id, school_id, delivery_date, meal_type, order_no, external_ref)
        values (run.center_id, v_school, v_date, coalesce(nullif(r->>'MEAL_TYPE_NM',''), '중식'), '', 'umji')
        on conflict (school_id, delivery_date, meal_type) do update set external_ref = coalesce(orders.external_ref, 'umji')
        returning id into v_order;
        v_ref := 'umji:' || coalesce(r->>'INV_SEQ','') || '-' || coalesce(r->>'INV_SERL','');
        insert into public.order_lines(order_id, center_id, school_id, delivery_date, item_id, qty, sale_price, purchase_price, status, external_ref)
        values (v_order, run.center_id, v_school, v_date, v_item, app.umji_num(r->>'QTY'),
                coalesce(app.umji_num(r->>'PRICE'),0), coalesce(app.umji_num(r->>'PU_PRICE'), app.umji_num(r->>'PRICE'), 0),
                'shipped', v_ref)
        on conflict (order_id, item_id) do update
          set qty = excluded.qty, sale_price = excluded.sale_price, purchase_price = excluded.purchase_price, external_ref = excluded.external_ref
          where order_lines.external_ref like 'umji:%';
      end if;
      update public.umji_staging set mapped = true, error = null where id = st.id;
      ok := ok + 1;
    exception when others then
      update public.umji_staging set error = sqlerrm where id = st.id;
      bad := bad + 1;
    end;
  end loop;

  update public.umji_sync_runs set mapped_count = mapped_count + ok, finished_at = now(),
         status = case when bad > 0 and ok = 0 then 'failed' else 'mapped' end,
         message = case when bad > 0 then bad || '건 오류 (umji_staging.error 확인)' else null end
  where id = p_run_id;
  perform app.log(run.center_id, 'umji.map', p_run_id::text, jsonb_build_object('ok', ok, 'error', bad));
  return jsonb_build_object('mapped', ok, 'errors', bad);
end $$;

-- 수집기에서 한 번에 적재 + 매핑
create or replace function public.umji_ingest(p_center_id uuid, p_dataset text, p_rows jsonb, p_source text default 'collector')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_run uuid; n int;
begin
  if not (app.is_staff(p_center_id) or app.is_service()) then raise exception '권한이 없습니다'; end if;
  insert into public.umji_sync_runs(center_id, source) values (p_center_id, p_source) returning id into v_run;
  insert into public.umji_staging(run_id, center_id, dataset, payload)
  select v_run, p_center_id, p_dataset, x from jsonb_array_elements(p_rows) x;
  get diagnostics n = row_count;
  update public.umji_sync_runs set row_count = n where id = v_run;
  return jsonb_build_object('run_id', v_run, 'loaded', n) || public.umji_map(v_run);
end $$;

grant execute on all functions in schema public to authenticated;
revoke execute on function public.umji_ingest(uuid, text, jsonb, text) from anon, public;
revoke execute on function public.umji_map(uuid) from anon, public;


-- ===== 20261106000500_modules.sql =====

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


-- ===== 20261106000600_center_info.sql =====

-- 0006: 센터정보 수정, 센터 간 거래 목록, 게시글 조회수

alter table public.centers add column ceo_name text;
alter table public.centers add column fax text;
alter table public.centers add column business_type text;
alter table public.centers add column note text;

-- 센터 관리자는 자기 센터 정보(코드 제외)를 수정할 수 있음
create policy centers_update_own on public.centers for update
  using (app.role() = 'center_admin' and id = app.center())
  with check (app.role() = 'center_admin' and id = app.center());

create or replace function app.tg_centers_guard() returns trigger
language plpgsql as $$
begin
  if new.code <> old.code and app.role() <> 'province_admin' then
    raise exception '센터코드는 도 관리자만 바꿀 수 있습니다';
  end if;
  return new;
end $$;
create trigger centers_guard before update on public.centers for each row execute function app.tg_centers_guard();

-- 우리 센터의 거래 목록 (상대 센터 상품명 포함)
create or replace function public.my_trades(p_center_id uuid)
returns table (id uuid, 구분 text, 상대센터 text, 상품 text, 단위 text, 거래일 date, 수량 numeric, 단가 numeric, 금액 numeric, 상태 text, 비고 text)
language sql stable security definer set search_path = public as $$
  select t.id, case when t.buyer_center_id = p_center_id then '매입' else '매출' end,
         case when t.buyer_center_id = p_center_id then sc.name else bc.name end,
         i.name, i.unit, t.trade_date, t.qty, t.price, round(t.qty * t.price), t.status, t.note
  from public.center_trades t join public.shared_items si on si.id = t.shared_item_id join public.items i on i.id = si.item_id
  join public.centers bc on bc.id = t.buyer_center_id join public.centers sc on sc.id = t.seller_center_id
  where app.is_staff(p_center_id) and (t.buyer_center_id = p_center_id or t.seller_center_id = p_center_id)
  order by t.created_at desc
$$;

create or replace function public.post_view(p_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.posts set views = views + 1
  where id = p_id and (center_id is null or app.in_center(center_id))
$$;

grant execute on all functions in schema public to authenticated;


-- ===== seed.sql (예시 기준정보: 홍천·춘천 센터) =====

-- 예시 기준정보 (데모·개발용). 운영 데이터는 umji 연계 또는 엑셀 업로드로 등록합니다.
-- 공급업체명·차량번호·인원·단가는 예시 값입니다.

insert into public.centers (id, code, name, sigungu, tel) values
  ('11111111-0000-0000-0000-000000000001', 'HC', '홍천군 학교급식지원센터', '홍천군', '033-430-0000'),
  ('11111111-0000-0000-0000-000000000002', 'CC', '춘천시 학교급식지원센터', '춘천시', '033-250-0000');

insert into public.courses (center_id, code, name, vehicle_no, driver_name, depart_time) values
  ('11111111-0000-0000-0000-000000000001', 'A', 'A코스 · 홍천읍',     '80바 1021', '김○○', '06:40'),
  ('11111111-0000-0000-0000-000000000001', 'B', 'B코스 · 읍내·북방',   '80바 1022', '이○○', '06:50'),
  ('11111111-0000-0000-0000-000000000001', 'C', 'C코스 · 서석·내촌',   '80바 1023', '최○○', '06:20'),
  ('11111111-0000-0000-0000-000000000002', 'A', 'A코스 · 시내',       '80바 2031', '박○○', '06:30');

insert into public.schools (center_id, code, name, school_level, meals, course_id, delivery_seq)
select '11111111-0000-0000-0000-000000000001', v.code, v.name, v.lvl, v.meals,
       (select id from public.courses where center_id = '11111111-0000-0000-0000-000000000001' and code = v.course), v.seq
from (values
  ('S101','홍천초등학교','초',620,'A',1), ('S102','홍천중학교','중',540,'A',2), ('S104','홍천여자중학교','중',380,'A',3),
  ('S105','남산초등학교','초',410,'A',4), ('S103','홍천고등학교','고',700,'B',1), ('S106','화산초등학교','초',260,'B',2),
  ('S107','서석초등학교','초',120,'C',1), ('S108','내촌초등학교','초',90,'C',2)
) as v(code,name,lvl,meals,course,seq);

insert into public.schools (center_id, code, name, school_level, meals, course_id, delivery_seq)
select '11111111-0000-0000-0000-000000000002', v.code, v.name, v.lvl, v.meals,
       (select id from public.courses where center_id = '11111111-0000-0000-0000-000000000002' and code = 'A'), v.seq
from (values ('S201','춘천초등학교','초',580,1), ('S202','춘천중학교','중',610,2)) as v(code,name,lvl,meals,seq);

insert into public.suppliers (center_id, code, name, kind, area) values
  ('11111111-0000-0000-0000-000000000001','P01','내면 고랭지작목반','농산물','내면'),
  ('11111111-0000-0000-0000-000000000001','P02','화촌 친환경영농조합','농산물','화촌면'),
  ('11111111-0000-0000-0000-000000000001','P03','서석 축산유통','축산물','서석면'),
  ('11111111-0000-0000-0000-000000000001','P04','북방 콩두부공방','가공품','북방면'),
  ('11111111-0000-0000-0000-000000000001','P05','두촌 산란계농장','축산물','두촌면'),
  ('11111111-0000-0000-0000-000000000001','P06','홍천 과수작목반','과일','남면'),
  ('11111111-0000-0000-0000-000000000002','P01','춘천 친환경채소회','농산물','동면');

insert into public.items (center_id, code, name, spec, unit, tax, supplier_id, category, cert_type, origin_detail, storage)
select '11111111-0000-0000-0000-000000000001', v.code, v.name, v.spec, v.unit, v.tax::public.tax_type,
       (select id from public.suppliers where center_id = '11111111-0000-0000-0000-000000000001' and code = v.sup),
       v.cat, v.cert, '강원 홍천', v.st::public.storage_type
from (values
  ('I01','감자(수미)','특','kg','exempt','P01','채소','무농약','ambient'),
  ('I02','양배추','상','kg','exempt','P01','채소','GAP','chilled'),
  ('I03','무','상','kg','exempt','P01','채소','GAP','chilled'),
  ('I04','대파','상','kg','exempt','P02','채소','유기농','chilled'),
  ('I05','애호박','개당 300g','개','exempt','P02','채소','무농약','chilled'),
  ('I06','찰옥수수(냉동)','2입','봉','exempt','P02','곡류','무농약','frozen'),
  ('I07','한우 앞다리(불고기용)','1등급','kg','exempt','P03','육류','무항생제','chilled'),
  ('I08','돼지 앞다리(찌개용)','1등급','kg','exempt','P03','육류','무항생제','chilled'),
  ('I09','두부(국산콩)','500g','모','exempt','P04','가공','일반','chilled'),
  ('I10','들기름','350ml','병','taxable','P04','가공','일반','ambient'),
  ('I11','계란(특란)','30구','판','exempt','P05','난류','동물복지','chilled'),
  ('I12','사과(부사)','중과','kg','exempt','P06','과일','GAP','chilled')
) as v(code,name,spec,unit,tax,sup,cat,cert,st);

insert into public.items (center_id, code, name, spec, unit, supplier_id, category, cert_type, origin_detail)
values ('11111111-0000-0000-0000-000000000002','I01','시금치','상','kg',
        (select id from public.suppliers where center_id = '11111111-0000-0000-0000-000000000002' and code = 'P01'),'채소','무농약','강원 춘천');

insert into public.item_prices (item_id, sale_price, purchase_price, valid_from)
select i.id, v.price, round(v.price * 0.88), '2026-09-01'
from public.items i join (values
  ('I01',2800),('I02',1900),('I03',1500),('I04',3600),('I05',1700),('I06',2600),
  ('I07',32000),('I08',11500),('I09',2400),('I10',12000),('I11',9800),('I12',6500)
) as v(code,price) on v.code = i.code
where i.center_id = '11111111-0000-0000-0000-000000000001';

insert into public.item_prices (item_id, sale_price, purchase_price, valid_from)
select id, 4200, 3700, '2026-09-01' from public.items where center_id = '11111111-0000-0000-0000-000000000002';


-- ===== 데모 계정 (비밀번호는 아래 한 곳에서만 지정) =====
do $$
declare pw text := 'Eum-jote3utSVE!';
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'province@eum.demo', extensions.crypt(pw, extensions.gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', jsonb_build_object('sub', 'aaaaaaaa-0000-4000-8000-000000000001', 'email', 'province@eum.demo', 'email_verified', true), 'email', now(), now(), now());
  insert into public.profiles (id, name, role, center_id, school_id, supplier_id) values ('aaaaaaaa-0000-4000-8000-000000000001', '도 급식담당', 'province_admin', null, null, null);
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'hongcheon@eum.demo', extensions.crypt(pw, extensions.gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), 'aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000002', jsonb_build_object('sub', 'aaaaaaaa-0000-4000-8000-000000000002', 'email', 'hongcheon@eum.demo', 'email_verified', true), 'email', now(), now(), now());
  insert into public.profiles (id, name, role, center_id, school_id, supplier_id) values ('aaaaaaaa-0000-4000-8000-000000000002', '홍천센터 관리자', 'center_admin', '11111111-0000-0000-0000-000000000001', null, null);
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'chuncheon@eum.demo', extensions.crypt(pw, extensions.gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), 'aaaaaaaa-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000003', jsonb_build_object('sub', 'aaaaaaaa-0000-4000-8000-000000000003', 'email', 'chuncheon@eum.demo', 'email_verified', true), 'email', now(), now(), now());
  insert into public.profiles (id, name, role, center_id, school_id, supplier_id) values ('aaaaaaaa-0000-4000-8000-000000000003', '춘천센터 관리자', 'center_admin', '11111111-0000-0000-0000-000000000002', null, null);
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 's101@eum.demo', extensions.crypt(pw, extensions.gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), 'aaaaaaaa-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000004', jsonb_build_object('sub', 'aaaaaaaa-0000-4000-8000-000000000004', 'email', 's101@eum.demo', 'email_verified', true), 'email', now(), now(), now());
  insert into public.profiles (id, name, role, center_id, school_id, supplier_id) values ('aaaaaaaa-0000-4000-8000-000000000004', '홍천초 영양교사', 'school', '11111111-0000-0000-0000-000000000001', (select id from public.schools where code='S101' and center_id='11111111-0000-0000-0000-000000000001'), null);
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'p01@eum.demo', extensions.crypt(pw, extensions.gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), 'aaaaaaaa-0000-4000-8000-000000000005', 'aaaaaaaa-0000-4000-8000-000000000005', jsonb_build_object('sub', 'aaaaaaaa-0000-4000-8000-000000000005', 'email', 'p01@eum.demo', 'email_verified', true), 'email', now(), now(), now());
  insert into public.profiles (id, name, role, center_id, school_id, supplier_id) values ('aaaaaaaa-0000-4000-8000-000000000005', '내면 고랭지작목반', 'supplier', '11111111-0000-0000-0000-000000000001', null, (select id from public.suppliers where code='P01' and center_id='11111111-0000-0000-0000-000000000001'));
end $$;