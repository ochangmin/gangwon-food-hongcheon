// 강원 먹거리 이음 — 자체 설치형 서버 (Vercel·Upstash 없이 한 대의 PC/서버에서 실행)
//   화면(public/) · API(api/) · 회원 로그인 관문 · 내장 저장소(storage/)를 한 프로세스로 띄운다.
//   실행: node server/server.js   (설정은 .env 파일 또는 환경변수)
'use strict';
const fs = require('fs'), path = require('path'), http = require('http'), https = require('https'), crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..');

// ── 설정 (.env → 환경변수) ──
(function loadEnv(){
  const f = path.join(ROOT, '.env');if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)){
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];if (/^".*"$|^'.*'$/.test(v)) v = v.slice(1, -1);if (process.env[m[1]] == null) process.env[m[1]] = v;
  }
})();
const PORT = +(process.env.PORT || 8080), HOST = process.env.HOST || '0.0.0.0';
const STORAGE = path.resolve(ROOT, process.env.STORAGE_DIR || 'storage');
const PUBLIC = path.join(ROOT, 'public');
const TLS = process.env.TLS_CERT && process.env.TLS_KEY;
const BEHIND_HTTPS_PROXY = process.env.TRUST_PROXY === '1';
// HTTPS 가 아니면(내부망 http 시험 운영) 로그인 쿠키에 Secure 를 붙이지 않는다 — 브라우저가 거부하므로
if (!TLS && !BEHIND_HTTPS_PROXY && process.env.COOKIE_INSECURE == null) process.env.COOKIE_INSECURE = '1';

function log(...a){console.log(new Date().toISOString().replace('T', ' ').slice(0, 19), ...a);}

async function main(){
  fs.mkdirSync(STORAGE, {recursive:true});
  // ── 저장소: UPSTASH_URL 이 있으면 외부 Upstash, 없으면 내장 저장소 ──
  if (!process.env.KV_REST_API_URL && !process.env.UPSTASH_REDIS_REST_URL){
    const {createStore} = require('./store');
    const st = createStore(STORAGE, {keepDays:+(process.env.BACKUP_KEEP_DAYS || 30)});
    process.env.KV_REST_API_URL = await st.listen();process.env.KV_REST_API_TOKEN = st.token;
    log('내장 저장소 사용:', path.join(STORAGE, 'store.json'));
  } else log('외부 Upstash 저장소 사용');
  // ── 최초 관리자 설정 코드: 설치마다 새로 만들고 storage/setup-code.txt 에 둔다 ──
  if (!process.env.ADMIN_SETUP_CODE){
    const f = path.join(STORAGE, 'setup-code.txt');
    let code = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim() : '';
    if (!code){const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';code = Array.from({length:4}, () => Array.from({length:5}, () => A[crypto.randomInt(A.length)]).join('')).join('-');fs.writeFileSync(f, code + '\n', {mode:0o600});}
    process.env.ADMIN_SETUP_CODE = code;
  }
  const C = require(path.join(ROOT, 'api/_lib/core'));
  const API = {};for (const n of ['auth', 'db', 'users', 'ledger']) API[n] = require(path.join(ROOT, 'api', n + '.js'));
  const admins = Number(await C.redis(['GET', 'sys:admins']) || 0);
  if (!admins) log(`아직 관리자 계정이 없습니다. 브라우저에서 /login 을 열고 최초 설정 코드 [${process.env.ADMIN_SETUP_CODE}] 로 관리자 계정을 만드세요. (코드는 storage/setup-code.txt 에도 있습니다)`);

  const TYPES = {'.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.txt':'text/plain; charset=utf-8',
    '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.webp':'image/webp', '.apk':'application/vnd.android.package-archive', '.woff2':'font/woff2'};
  const PUBLIC_PATHS = /^\/(login(\.html)?|api\/auth|img\/(?:org-logo|wordmark|wordmark-h|apple-touch-icon|icon-192)\.png|robots\.txt|favicon\.ico|vendor\/.*)$/;
  const secHeaders = (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');res.setHeader('Referrer-Policy', 'same-origin');res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');res.setHeader('Permissions-Policy', 'camera=(), microphone=(), payment=(), usb=(), geolocation=(self), bluetooth=(self)');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self'; base-uri 'self'; object-src 'none'; form-action 'self'");
    if (TLS || (BEHIND_HTTPS_PROXY && req.headers['x-forwarded-proto'] === 'https')) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  };
  const sessionOk = async req => {const t = C.cookieTok(req);return !!(t && await C.verify(t));};

  async function handler(req, res){
    const t0 = Date.now();
    try{
      // 클라이언트가 보낸 IP 머리글은 믿지 않고, 실제 접속 주소(또는 신뢰하는 프록시가 준 값)만 쓴다
      const ip = BEHIND_HTTPS_PROXY ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress : req.socket.remoteAddress;
      delete req.headers['x-vercel-forwarded-for'];req.headers['x-real-ip'] = String(ip || '').replace(/^::ffff:/, '');
      const url = new URL(req.url, 'http://x');let p = decodeURIComponent(url.pathname);
      secHeaders(req, res);
      if (p.includes('\0') || p.split('/').includes('..')){res.statusCode = 400;return res.end();}
      // 로그인 관문
      if (!PUBLIC_PATHS.test(p) && !(await sessionOk(req))){
        if (p.startsWith('/api/')){res.statusCode = 401;res.setHeader('Content-Type', 'application/json; charset=utf-8');return res.end('{"error":"login"}');}
        if (p === '/' || p === '/index' || p === '/index.html'){res.statusCode = 302;res.setHeader('Location', '/login');return res.end();}
        res.statusCode = 401;res.setHeader('Content-Type', 'text/plain; charset=utf-8');return res.end('로그인이 필요합니다.');
      }
      // API
      const m = p.match(/^\/api\/([a-z]+)$/);
      if (m){const h = API[m[1]];if (!h){res.statusCode = 404;return res.end();}return await h(req, res);}
      // 정적 파일 (주소 끝 .html 생략 가능)
      if (p === '/') p = '/index.html';
      let f = path.join(PUBLIC, p);if (!f.startsWith(PUBLIC + path.sep) && f !== PUBLIC){res.statusCode = 400;return res.end();}
      if (!fs.existsSync(f) && fs.existsSync(f + '.html')) f += '.html';
      fs.stat(f, (e, s) => {
        if (e || !s.isFile()){res.statusCode = 404;res.setHeader('Content-Type', 'text/plain; charset=utf-8');return res.end('없는 페이지입니다.');}
        res.setHeader('Content-Type', TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream');
        if (f === path.join(PUBLIC, 'index.html')){ // 지도 키는 설치마다 .env 의 VWORLD_KEY 로
          const html = fs.readFileSync(f, 'utf8').replace('__VWORLD_KEY__', String(process.env.VWORLD_KEY || '').replace(/[^A-Za-z0-9-]/g, ''));
          res.setHeader('Cache-Control', 'no-store');return res.end(html);}
        res.setHeader('Cache-Control', /\.html$/.test(f) ? 'no-store' : 'public, max-age=3600');res.setHeader('Content-Length', s.size);
        fs.createReadStream(f).pipe(res);
      });
    }catch(e){log('오류', e);if (!res.headersSent){res.statusCode = 500;res.end('server error');}}
    finally{res.on('finish', () => {if (process.env.ACCESS_LOG === '1' || res.statusCode >= 500) log(req.method, req.url.split('?')[0], res.statusCode, (Date.now() - t0) + 'ms');});}
  }
  const srv = TLS ? https.createServer({cert:fs.readFileSync(process.env.TLS_CERT), key:fs.readFileSync(process.env.TLS_KEY)}, handler) : http.createServer(handler);
  srv.on('error', e => {console.error(e.code === 'EADDRINUSE' ? `${PORT} 포트를 이미 다른 프로그램(또는 이미 켜진 서버)이 쓰고 있습니다. .env 의 PORT 를 바꾸거나 기존 서버를 끄세요.` : '서버 오류: ' + e.message);process.exit(1);});
  srv.listen(PORT, HOST, () => log(`강원 먹거리 이음 서버 시작 — ${TLS ? 'https' : 'http'}://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}  (저장 위치: ${STORAGE})`));
}
main().catch(e => {console.error('서버를 시작하지 못했습니다:', e.message || e);process.exit(1);});
