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
