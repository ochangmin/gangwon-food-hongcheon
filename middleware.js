// 급식.shop 서버 차단: 접속 코드로 잠금을 푼 브라우저(gk 쿠키)만 자료·앱 파일을 받을 수 있다.
// 쿠키 값은 내용 키로 만든 HMAC 토큰이며, 여기에는 그 SHA-256 값만 들어 있다.
export const config = {matcher: ['/data/:path*', '/downloads/:path*']};
const GATE_HASH = '9a4265c8442b04389adf7c5e362be4f8caa70693dfe99f8ec7c35c2ce9d0fb66';
export default async function middleware(req){
  const m = (req.headers.get('cookie') || '').match(/(?:^|;\s*)gk=([^;]+)/);
  if (m){
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(decodeURIComponent(m[1]))));
    let hx = '';for (const b of d) hx += b.toString(16).padStart(2, '0');
    if (hx === GATE_HASH) return new Response(null, {headers:{'x-middleware-next':'1'}});
  }
  return new Response('접속 코드가 필요합니다.', {status:401, headers:{'content-type':'text/plain; charset=utf-8', 'cache-control':'no-store'}});
}
