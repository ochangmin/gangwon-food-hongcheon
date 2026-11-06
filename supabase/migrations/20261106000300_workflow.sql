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
