// umji 메뉴 구조와 같은 상단 메뉴 + 좌측 메뉴
import type { Role } from './session';

export type MenuItem = { href: string; label: string; umji?: string };
export type MenuGroup = { g: string; items: MenuItem[] };
export type Top = { label: string; groups: MenuGroup[] };

export const CENTER_MENU: Top[] = [
  {
    label: '주문관리',
    groups: [
      { g: '현황', items: [{ href: '/center', label: '오늘 현황' }] },
      {
        g: '주문 및 발주',
        items: [
          { href: '/center/m/market-prices', label: '시장조사단가', umji: 'SA010020' },
          { href: '/center/m/temp-estimates', label: '임시견적(월간)', umji: 'SA010010' },
          { href: '/center/order-entry?mode=week', label: '발주등록(주간)', umji: 'SA020010' },
          { href: '/center/order-entry?mode=month', label: '발주등록(월간)', umji: 'SA020010_MONTH' },
          { href: '/center/orders', label: '주문확정', umji: 'SA020120' },
          { href: '/center/changes', label: '주문변경요청', umji: 'SA020015' },
          { href: '/center/changes?view=history', label: '주문변경내역', umji: 'SA020122' },
          { href: '/center/r/po-status', label: '상품발주현황', umji: 'PU010210' },
          { href: '/center/m/closings', label: '마감처리(업무별)', umji: 'MA100050' },
        ],
      },
      {
        g: '입/출고 관리',
        items: [
          { href: '/center/purchase', label: '입고처리', umji: 'PU010400' },
          { href: '/center/shipping', label: '출고처리', umji: 'SA020240' },
          { href: '/center/delivery', label: '상차일보', umji: 'SA020230' },
          { href: '/center/m/stock-in', label: '입고처리_유통', umji: 'PU010410' },
        ],
      },
      {
        g: '배송관리',
        items: [
          { href: '/center/lots', label: '배송물류정보', umji: 'LG040210' },
          { href: '/center/masters?tab=courses', label: '배송코스관리', umji: 'LG020150' },
        ],
      },
      {
        g: '클레임관리',
        items: [
          { href: '/center/claims', label: '클레임처리', umji: 'QC010110' },
          { href: '/center/r/claims', label: '클레임현황(검수)', umji: 'QC010111' },
        ],
      },
      { g: '출력물모음', items: [{ href: '/center/prints', label: '출력물모음', umji: 'FC030010' }] },
      {
        g: '통계현황',
        items: [
          { href: '/center/r/sales', label: '매출(입) 집계표', umji: 'ST010010' },
          { href: '/center/r/sales-daily', label: '매출(입) 일집계표', umji: 'ST010020' },
          { href: '/center/r/supply', label: '식재료공급현황', umji: 'ST010030' },
          { href: '/center/r/frequency', label: '식재료발주빈도', umji: 'ST010040' },
          { href: '/center/r/local-food', label: '도내산 식재료 사용현황', umji: 'ST010050' },
          { href: '/center/r/eco-food', label: '친환경(우수) 식재료 사용현황', umji: 'ST010052' },
        ],
      },
    ],
  },
  {
    label: '상품관리',
    groups: [
      {
        g: '상품등록관리',
        items: [
          { href: '/center/masters?tab=items', label: '품목기본정보등록', umji: 'MA010110' },
          { href: '/center/m/item-details', label: '상품상세정보', umji: 'MA010120' },
          { href: '/center/m/item-prices', label: '상품단가등록', umji: 'PU010110' },
          { href: '/center/m/suspensions', label: '단가(일시)중단처리', umji: 'PU010150' },
        ],
      },
      {
        g: '식재료 기준 관리',
        items: [
          { href: '/center/m/std-attrs', label: '표준속성값설정', umji: 'MA100060' },
          { href: '/center/m/neis-foods', label: 'NEIS 식재료코드', umji: 'MA100062' },
          { href: '/center/m/item-std', label: '표준식재료등록', umji: 'MA100064' },
          { href: '/center/r/std-items', label: '표준상품등록현황', umji: 'MA100066' },
        ],
      },
      {
        g: '원물관리',
        items: [
          { href: '/center/m/raw-orders', label: '원물발주등록', umji: 'PU020310' },
          { href: '/center/m/raw-receipts', label: '원물입고등록', umji: 'PU020410' },
          { href: '/center/m/work-orders', label: '작업지시 및 상품화', umji: 'PU020420' },
          { href: '/center/m/work-logs', label: '작업일지', umji: 'PU020430' },
          { href: '/center/r/stock', label: '재고현황', umji: 'PU020440' },
        ],
      },
      {
        g: '센터 간 거래',
        items: [
          { href: '/center/m/shared-items', label: '공유상품등록', umji: 'PU020010' },
          { href: '/center/trades', label: '전체공유상품현황', umji: 'PU020020' },
          { href: '/center/r/trades', label: '센터 간 거래 매입(출)', umji: 'PU020030' },
        ],
      },
      {
        g: '인증 및 안전성',
        items: [
          { href: '/center/m/certifications', label: '인증정보 등록 관리', umji: 'QC020010' },
          { href: '/center/r/cert-check', label: '인증정보 검증 현황', umji: 'QC020020' },
          { href: '/center/m/safety-tests', label: '안전성 검사결과 등록', umji: 'QC010210' },
        ],
      },
      { g: '농산물 이력', items: [{ href: '/center/r/trace', label: '농산물 이력 현황', umji: 'QC020040' }] },
    ],
  },
  {
    label: '보조금관리',
    groups: [
      {
        g: '보조금관리',
        items: [
          { href: '/center/m/subsidy-standards', label: '통합급식기준설정', umji: 'SU010060' },
          { href: '/center/m/subsidy-budgets', label: '보조금예산(연간)', umji: 'SU010010' },
          { href: '/center/m/subsidy-monthly', label: '보조금예산(월간)', umji: 'SU010020' },
          { href: '/center/r/subsidy', label: '보조금예산현황(월간)', umji: 'SU010021' },
          { href: '/center/subsidy-settle', label: '보조금정산관리', umji: 'SU010030' },
          { href: '/center/r/subsidy-usage', label: '보조금사용실적(월)', umji: 'SU010040' },
          { href: '/center/r/subsidy-year', label: '보조금정산결과(년)', umji: 'SU010050' },
        ],
      },
    ],
  },
  {
    label: '기준정보관리',
    groups: [
      {
        g: '거래처 계정 관리',
        items: [
          { href: '/center/masters?tab=suppliers', label: '거래처등록', umji: 'MA010210' },
          { href: '/center/m/producers', label: '생산자등록', umji: 'MA010230' },
          { href: '/center/masters?tab=schools', label: '거래처현황(학교)', umji: 'MA010220' },
          { href: '/center/users', label: '사용자등록', umji: 'UserMng' },
        ],
      },
      {
        g: '기준정보',
        items: [
          { href: '/center/center-info', label: '센터정보', umji: 'MA010100' },
          { href: '/center/m/seals', label: '인장관리', umji: 'FC010010' },
          { href: '/center/m/vehicles', label: '배송차량 등록관리', umji: 'LG020010' },
          { href: '/center/m/drivers', label: '운행기사 등록관리', umji: 'LG020020' },
          { href: '/center/m/warehouses', label: '창고 등록관리', umji: 'LG030010' },
          { href: '/center/m/regions', label: '권역설정(매칭)', umji: 'MA100070' },
          { href: '/center/m/school-discounts', label: '학교별할인율', umji: 'MA100080' },
          { href: '/center/m/matching-history', label: '학교별매칭이력', umji: 'MA100072' },
        ],
      },
      {
        g: '마감관리',
        items: [
          { href: '/center/m/closings', label: '마감처리(업무별)', umji: 'MA100050' },
          { href: '/center/m/closings-partner', label: '마감처리(거래처별)', umji: 'MA100052' },
        ],
      },
    ],
  },
  {
    label: '시스템관리',
    groups: [
      {
        g: '시스템 관리',
        items: [
          { href: '/center/m/codes', label: '공통코드등록', umji: 'CodeDataMng' },
          { href: '/center/m/permissions', label: '프로그램권한', umji: 'ProgramMng · ButtonAuthMng' },
          { href: '/center/m/glossary', label: '용어등록', umji: 'GlossaryMng' },
          { href: '/center/m/messages', label: '메세지등록', umji: 'MessageMng' },
          { href: '/center/access-logs', label: '사용자정보접속로그', umji: 'UserInfoAccess' },
        ],
      },
      { g: '연계', items: [{ href: '/center/umji', label: 'umji 연계' }] },
    ],
  },
  {
    label: '커뮤니티',
    groups: [{ g: '커뮤니티', items: [{ href: '/board/notice', label: '공지사항', umji: 'FC040010' }, { href: '/board/free', label: '자유게시판', umji: 'FC040020' }] }],
  },
];

export const SCHOOL_MENU: Top[] = [
  {
    label: '주문',
    groups: [
      { g: '주문', items: [{ href: '/school', label: '주간 주문' }, { href: '/school?mode=month', label: '월간 주문' }, { href: '/school/changes', label: '주문변경요청' }] },
      { g: '납품', items: [{ href: '/school/deliveries', label: '납품·검수' }, { href: '/school/claims', label: '클레임' }] },
      { g: '보조금', items: [{ href: '/school/subsidy', label: '보조금 현황' }] },
    ],
  },
  { label: '커뮤니티', groups: [{ g: '커뮤니티', items: [{ href: '/board/notice', label: '공지사항' }, { href: '/board/free', label: '자유게시판' }] }] },
];

export const SUPPLIER_MENU: Top[] = [
  {
    label: '발주',
    groups: [
      { g: '발주', items: [{ href: '/supplier', label: '발주 확인' }, { href: '/supplier/lots', label: '입고·로트 이력' }] },
      { g: '인증', items: [{ href: '/supplier/certs', label: '인증정보' }] },
    ],
  },
  { label: '커뮤니티', groups: [{ g: '커뮤니티', items: [{ href: '/board/notice', label: '공지사항' }, { href: '/board/free', label: '자유게시판' }] }] },
];

export function menuFor(role: Role): Top[] {
  if (role === 'school') return SCHOOL_MENU;
  if (role === 'supplier') return SUPPLIER_MENU;
  const m = CENTER_MENU;
  if (role === 'province_admin') return [{ label: '도', groups: [{ g: '도', items: [{ href: '/province', label: '도 통합 현황' }] }] }, ...m];
  return m;
}
