// 급식.shop 공유 DB 서버 — 공통 모듈
// 저장소: Upstash Redis (Vercel Storage 연동 시 KV_REST_API_URL / KV_REST_API_TOKEN 환경변수 자동 설정)
// 컬렉션마다 Redis 해시 하나(c:<컬렉션>)에 문서 id → JSON 으로 저장한다.
const crypto = require('crypto');

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const TOKEN_ = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const configured = () => !!(URL_ && TOKEN_);

// ── 저장 데이터 암호화 (AES-256-GCM) ──
// Vercel 환경변수 DATA_ENC_KEY (32바이트를 base64로) 가 있어야 데이터 읽기·쓰기를 허용한다.
// 키는 저장소(Redis)와 분리돼 있으므로, 저장소 내용이 새어도 키 없이는 읽을 수 없다.
const DEK = (() => {try{const b = Buffer.from(process.env.DATA_ENC_KEY || '', 'base64');return b.length === 32 ? b : null;}catch(e){return null;}})();
const encReady = () => !!DEK;
function enc(obj){
  const iv = crypto.randomBytes(12);const c = crypto.createCipheriv('aes-256-gcm', DEK, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return 'e1:' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
function dec(s){
  if (typeof s !== 'string') return null;
  if (!s.startsWith('e1:')) return JSON.parse(s); // 암호화 이전 데이터
  const b = Buffer.from(s.slice(3), 'base64');const d = crypto.createDecipheriv('aes-256-gcm', DEK, b.subarray(0, 12));d.setAuthTag(b.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'));
}
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');

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

async function getDoc(col, id){const v = await redis(['HGET', 'c:' + col, id]);return v ? dec(v) : null;}
async function putDoc(col, id, data){await redis(['HSET', 'c:' + col, id, enc(data)]);}
async function delDoc(col, id){await redis(['HDEL', 'c:' + col, id]);}
async function listCol(col){
  const flat = await redis(['HGETALL', 'c:' + col]) || [];const out = [];
  for (let i = 0; i < flat.length; i += 2){try{out.push({id:flat[i], data:dec(flat[i + 1])});}catch(e){}}
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

// ── 변경 원장 (블록체인식 해시 체인) ──
// 모든 쓰기를 한 줄씩 원장에 남긴다. 각 블록 = 직전 블록 해시 + 이번 변경(컬렉션·문서·작업·작성자·문서 내용 해시·시각)의 HMAC 서명.
// 블록 해시 = SHA1(직전 해시 | 내용) — Redis 안에서 원자적으로 이어 붙여 순서가 꼬이지 않는다.
// 서버 비밀키가 있어야 서명을 만들 수 있으므로, 저장소에 접근한 누군가가 기록을 고치거나 끼워 넣으면 검증에서 드러난다.
const LEDGER_LUA = "local h = redis.call('GET', KEYS[1]) or 'GENESIS' local n = sha1hex(h .. '|' .. ARGV[1]) redis.call('RPUSH', KEYS[2], n .. '|' .. h .. '|' .. ARGV[1]) redis.call('SET', KEYS[1], n) return n";
async function ledger(entry){
  const body = JSON.stringify(entry);const mac = crypto.createHmac('sha256', await secret()).update(body).digest('hex');
  return redis(['EVAL', LEDGER_LUA.replace('sha1hex', 'redis.sha1hex'), '2', 'sys:ledger_head', 'sys:ledger', mac + '|' + body]);
}
async function ledgerVerify(){
  const rows = await redis(['LRANGE', 'sys:ledger', '0', '-1']) || [];const key = await secret();
  let prev = 'GENESIS', i = 0;
  for (const r of rows){
    const p1 = r.indexOf('|'), p2 = r.indexOf('|', p1 + 1);const h = r.slice(0, p1), ph = r.slice(p1 + 1, p2), payload = r.slice(p2 + 1);
    const p3 = payload.indexOf('|');const mac = payload.slice(0, p3), body = payload.slice(p3 + 1);
    const okLink = ph === prev, okHash = crypto.createHash('sha1').update(ph + '|' + payload).digest('hex') === h;
    const okMac = crypto.createHmac('sha256', key).update(body).digest('hex') === mac;
    if (!okLink || !okHash || !okMac) return {ok:false, n:rows.length, brokenAt:i, reason:!okLink ? '연결 끊김' : !okHash ? '해시 불일치' : '서명 불일치'};
    prev = h;i++;
  }
  const head = await redis(['GET', 'sys:ledger_head']);
  return {ok:head == null ? rows.length === 0 : head === prev, n:rows.length, head:prev};
}
async function ledgerTail(n){
  const rows = await redis(['LRANGE', 'sys:ledger', String(-n), '-1']) || [];
  return rows.map(r => {const p1 = r.indexOf('|'), p2 = r.indexOf('|', p1 + 1);const payload = r.slice(p2 + 1);const body = payload.slice(payload.indexOf('|') + 1);let e = {};try{e = JSON.parse(body);}catch(x){}return Object.assign({hash:r.slice(0, p1)}, e);}).reverse();
}

module.exports = {encReady, sha256, ledger, ledgerVerify, ledgerTail, configured, redis, pipeline, splitPath, getDoc, putDoc, delDoc, listCol, newHash, checkPw, sign, verify, who, rateOk, body, send, COL_RE};
