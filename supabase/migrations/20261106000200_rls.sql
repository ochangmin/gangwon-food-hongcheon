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
