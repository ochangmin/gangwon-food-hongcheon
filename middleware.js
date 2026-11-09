// 급식.shop 로그인 관문 (Vercel Edge)
// 회원 저장소(Upstash)가 연결되면, 로그인 세션 쿠키(gs)가 없는 요청은
// 화면 대신 로그인 페이지로 보내고 자료·API는 401로 막는다. 설정 전에는 지금처럼 그대로 열어 둔다.
export const config = {matcher: ['/((?!login|api/auth|img/(?:org-logo|wordmark|wordmark-h|apple-touch-icon|icon-192)\\.png|robots\\.txt|favicon\\.ico).*)']};
const te = new TextEncoder();
const b64u = a => {let s = '';for (const x of a) s += String.fromCharCode(x);return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');};
let SECRET = null;
async function secret(){
  if (SECRET) return SECRET;
  if (process.env.AUTH_SECRET) return SECRET = process.env.AUTH_SECRET;
  let kb = process.env.DATA_ENC_KEY || '';
  if (!kb){ // 키가 환경변수에 없으면 서버가 저장소에 만들어 둔 키를 읽는다 (api/_lib/core.js dek())
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL, tok = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
    const r = await fetch(url, {method:'POST', headers:{Authorization:'Bearer ' + tok, 'Content-Type':'application/json'}, body:JSON.stringify(['GET', 'sys:dek'])});
    kb = (await r.json()).result || '';if (!kb) return null; // 아직 아무도 로그인하지 않음
  }
  const raw = Uint8Array.from(atob(kb), c => c.charCodeAt(0));
  const k = await crypto.subtle.importKey('raw', raw, {name:'HMAC', hash:'SHA-256'}, false, ['sign']);
  const d = new Uint8Array(await crypto.subtle.sign('HMAC', k, te.encode('gwfood-auth-secret-v1')));
  let s = '';for (const x of d) s += String.fromCharCode(x);return SECRET = btoa(s); // api/_lib/core.js 와 같은 방식
}
async function valid(tok){
  if (!tok || tok.indexOf('.') < 0) return false;
  const [body, mac] = tok.split('.');
  const sec = await secret();if (!sec) return false;
  const k = await crypto.subtle.importKey('raw', te.encode(sec), {name:'HMAC', hash:'SHA-256'}, false, ['sign']);
  const want = b64u(new Uint8Array(await crypto.subtle.sign('HMAC', k, te.encode(body))));
  if (want.length !== mac.length) return false;let diff = 0;for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ mac.charCodeAt(i);if (diff) return false;
  try{const c = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/')));return !!c.exp && Date.now() < c.exp;}catch(e){return false;}
}
export default async function middleware(req){
  const on = !!((process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL) && (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN));
  if (!on) return new Response(null, {headers:{'x-middleware-next':'1'}});
  const m = (req.headers.get('cookie') || '').match(/(?:^|;\s*)gs=([^;]+)/);
  if (m && await valid(decodeURIComponent(m[1]))) return new Response(null, {headers:{'x-middleware-next':'1'}});
  const u = new URL(req.url);
  if (u.pathname.startsWith('/api/')) return new Response(JSON.stringify({error:'login'}), {status:401, headers:{'content-type':'application/json; charset=utf-8', 'cache-control':'no-store'}});
  if (u.pathname === '/' || u.pathname === '/index.html' || u.pathname === '/index') return Response.redirect(new URL('/login' + (u.hash || ''), u), 302);
  return new Response('로그인이 필요합니다.', {status:401, headers:{'content-type':'text/plain; charset=utf-8', 'cache-control':'no-store'}});
}
