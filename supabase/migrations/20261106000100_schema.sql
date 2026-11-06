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
