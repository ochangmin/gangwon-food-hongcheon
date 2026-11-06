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
