// 범용 관리 화면(목록·등록·수정·삭제)과 통계 화면 정의 형식

export type FieldType = 'text' | 'textarea' | 'number' | 'money' | 'date' | 'datetime' | 'month' | 'year' | 'bool' | 'select' | 'ref' | 'image';

export type Field = {
  k: string;
  label: string;
  type: FieldType;
  options?: string[] | { v: string; l: string }[];
  /** ref: 같은 센터의 다른 테이블 행 선택 */
  ref?: { table: string; label: string; extra?: string; value?: string };
  required?: boolean;
  list?: boolean; // 목록에 표시 (기본 true)
  form?: boolean; // 등록/수정 폼에 표시 (기본 true)
  filter?: boolean; // 조회조건에 표시
  default?: string | number | boolean | 'today' | 'thismonth' | 'thisyear';
  help?: string;
};

export type Screen = {
  key: string;
  title: string;
  umji?: string;
  desc: string;
  table: string;
  order: { k: string; asc?: boolean }[];
  fields: Field[];
  readonly?: boolean;
  /** 신규 등록 없이 수정만 (예: 상품 상세) */
  noCreate?: boolean;
  /** 항상 고정되는 값 (목록 필터·저장 시 자동 지정) */
  fixed?: Record<string, string>;
  /** 날짜 범위 조회에 쓸 필드 */
  dateField?: string;
};

export type ReportCol = { k: string; type?: 'text' | 'number' | 'money' | 'pct' | 'date' };
export type Report = {
  key: string;
  title: string;
  umji?: string;
  desc: string;
  rpc: string;
  groups?: { v: string; l: string }[];
  money?: string[]; // 금액 컬럼명
  pct?: string[]; // 비율 컬럼명
  defaultRange?: 'month' | 'year' | 'week';
};
