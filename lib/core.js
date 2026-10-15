// 급식.shop 공유 DB 서버 — 공통 모듈
// 저장소: Upstash Redis (Vercel Storage 연동 시 KV_REST_API_URL / KV_REST_API_TOKEN 환경변수 자동 설정)
// 컬렉션마다 Redis 해시 하나(c:<컬렉션>)에 문서 id → JSON 으로 저장한다.
const crypto = require('crypto');

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const TOKEN_ = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const configured = () => !!(URL_ && TOKEN_);

async function redis(cmd){
  const r = await fetch(URL_, {method:'POST', headers:{Authorization:'Bearer ' + TOKEN_, 'Content-Type':'application/json'}, body:JSON.stringify(cmd)});
  const j = await r.json();
  if (j.error) throw new Error('redis: ' + j.error);
  return j.result;
}
async function pipeline(cmds){
  if (!cmds.length) return [];
  const r = await fetch(URL_.replace(/\/$/, '') + '/pipeline', {method:'POST', headers:{Authorization:'Bearer ' + TOKEN_, 'Content-Type':'application/json'}, body:JSON.stringify(cmds)});
  const j = await r.json();
  return j.map(x => {if (x.error) throw new Error('redis: ' + x.error);return x.result;});
}

const COL_RE = /^[A-Za-z0-9_\-]{1,60}$/, ID_RE = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;
function splitPath(p){const a = String(p || '').split('/');if (a.length !== 2 || !COL_RE.test(a[0]) || !ID_RE.test(a[1])) return null;return {col:a[0], id:a[1]};}

async function getDoc(col, id){const v = await redis(['HGET', 'c:' + col, id]);return v ? JSON.parse(v) : null;}
async function putDoc(col, id, data){await redis(['HSET', 'c:' + col, id, JSON.stringify(data)]);}
async function delDoc(col, id){await redis(['HDEL', 'c:' + col, id]);}
async function listCol(col){
  const flat = await redis(['HGETALL', 'c:' + col]) || [];const out = [];
  for (let i = 0; i < flat.length; i += 2){try{out.push({id:flat[i], data:JSON.parse(flat[i + 1])});}catch(e){}}
  return out;
}

// ── 비밀번호 (브라우저의 pwHash 와 같은 PBKDF2-SHA256, base64) ──
function pwHash(pw, saltB64, iter){return crypto.pbkdf2Sync(String(pw), Buffer.from(saltB64, 'base64'), iter, 32, 'sha256').toString('base64');}
function newHash(pw){const salt = crypto.randomBytes(16).toString('base64');const iter = 150000;return {salt, iter, hash:pwHash(pw, salt, iter)};}
function checkPw(pw, rec){if (!rec || !rec.salt || !rec.hash) return false;const h = pwHash(pw, rec.salt, rec.iter || 150000);return crypto.timingSafeEqual(Buffer.from(h), Buffer.from(rec.hash));}

// ── 토큰 (HMAC 서명) ──
let SECRET = process.env.AUTH_SECRET || null;
async function secret(){
  if (SECRET) return SECRET;
  let s = await redis(['GET', 'sys:secret']);
  if (!s){s = crypto.randomBytes(32).toString('base64');await redis(['SET', 'sys:secret', s, 'NX']);s = await redis(['GET', 'sys:secret']);}
  return SECRET = s;
}
const b64u = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function sign(claims){const body = b64u(JSON.stringify(claims));const mac = b64u(crypto.createHmac('sha256', await secret()).update(body).digest());return body + '.' + mac;}
async function verify(tok){
  if (!tok || typeof tok !== 'string' || !tok.includes('.')) return null;
  const [body, mac] = tok.split('.');const want = b64u(crypto.createHmac('sha256', await secret()).update(body).digest());
  if (mac.length !== want.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return null;
  try{const c = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());if (!c.exp || Date.now() > c.exp) return null;return c;}catch(e){return null;}
}
async function who(req){const h = req.headers.authorization || '';return verify(h.startsWith('Bearer ') ? h.slice(7) : null);}

// 로그인 시도 제한: 같은 IP·계정 10분에 10회
async function rateOk(req, key){
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'x';
  const k = 'rl:' + ip + ':' + key;const [n] = await pipeline([['INCR', k], ['EXPIRE', k, 600]]);return n <= 10;
}

async function body(req){
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string'){try{return JSON.parse(req.body);}catch(e){return {};}}
  const chunks = [];for await (const c of req) chunks.push(c);try{return JSON.parse(Buffer.concat(chunks).toString() || '{}');}catch(e){return {};}
}
function send(res, code, obj){res.statusCode = code;res.setHeader('Content-Type', 'application/json; charset=utf-8');res.setHeader('Cache-Control', 'no-store');res.end(JSON.stringify(obj));}

module.exports = {configured, redis, pipeline, splitPath, getDoc, putDoc, delDoc, listCol, newHash, checkPw, sign, verify, who, rateOk, body, send, COL_RE};
