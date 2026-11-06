import { NextResponse, type NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { adminClient } from '@/lib/supabase/server';

// umji 수집기 → 이음 적재 API
// POST { center: "HC", dataset: "shipments" | "schools" | "suppliers" | "items", rows: [...] }
// Authorization: Bearer <UMJI_INGEST_TOKENS 의 해당 센터 토큰>

const ALLOW_ORIGIN = 'http://umji.gwd.go.kr';
const cors = {
  'Access-Control-Allow-Origin': ALLOW_ORIGIN,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const DATASETS = ['shipments', 'schools', 'suppliers', 'items'];

function tokens(): Map<string, string> {
  const m = new Map<string, string>();
  (process.env.UMJI_INGEST_TOKENS ?? '').split(',').forEach((pair) => {
    const [code, tok] = pair.split(':').map((s) => s?.trim());
    if (code && tok && tok.length >= 24) m.set(code, tok);
  });
  return m;
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors });
}

export async function POST(req: NextRequest) {
  const fail = (status: number, error: string) => NextResponse.json({ error }, { status, headers: cors });
  let body: { center?: string; dataset?: string; rows?: unknown[] };
  try {
    body = await req.json();
  } catch {
    return fail(400, 'JSON 본문이 필요합니다');
  }
  const code = String(body.center ?? '');
  const expected = tokens().get(code);
  const given = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const same = !!expected && given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!same) return fail(401, '센터 코드 또는 수집 토큰이 맞지 않습니다');
  if (!DATASETS.includes(String(body.dataset))) return fail(400, 'dataset은 ' + DATASETS.join(', ') + ' 중 하나여야 합니다');
  if (!Array.isArray(body.rows) || !body.rows.length) return fail(400, 'rows 배열이 비어 있습니다');
  if (body.rows.length > 20000) return fail(413, '한 번에 20,000행까지 보낼 수 있습니다');

  const sb = adminClient();
  const { data: center } = await sb.from('centers').select('id').eq('code', code).single();
  if (!center) return fail(404, '센터를 찾을 수 없습니다');
  const { data, error } = await sb.rpc('umji_ingest', { p_center_id: center.id, p_dataset: body.dataset, p_rows: body.rows, p_source: 'collector' });
  if (error) return fail(500, error.message);
  return NextResponse.json(data, { headers: cors });
}
