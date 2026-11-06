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
