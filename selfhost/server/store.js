// 내장 저장소 — Upstash Redis REST 와 같은 방식(POST JSON 명령)으로 응답하는 작은 저장소.
// 서버 코드(api/_lib/core.js)는 바꾸지 않고, 주소만 이 저장소로 돌린다.
// 내용은 storage/store.json 에 저장(변경 후 0.5초 안에, 임시 파일 → 이름 바꾸기로 안전하게), 하루 한 번 storage/backups 에 사본.
'use strict';
const fs = require('fs'), path = require('path'), http = require('http'), crypto = require('crypto');

function createStore(dir, opts = {}){
  fs.mkdirSync(path.join(dir, 'backups'), {recursive:true});
  const file = path.join(dir, 'store.json');
  let H = {}, KV = {}, L = {}, EXP = {};
  try{const j = JSON.parse(fs.readFileSync(file, 'utf8'));H = j.H || {};KV = j.KV || {};L = j.L || {};EXP = j.EXP || {};}catch(e){if (e.code !== 'ENOENT') throw new Error('저장소 파일을 읽지 못했습니다: ' + e.message);}
  let timer = null, dirty = false;
  function flush(){
    if (!dirty) return;dirty = false;
    const tmp = file + '.tmp';fs.writeFileSync(tmp, JSON.stringify({v:1, at:Date.now(), H, KV, L, EXP}));fs.renameSync(tmp, file);
    const day = new Date().toISOString().slice(0, 10), bk = path.join(dir, 'backups', `store-${day}.json`);
    if (!fs.existsSync(bk)){fs.copyFileSync(file, bk);const keep = opts.keepDays || 30;
      fs.readdirSync(path.join(dir, 'backups')).filter(f => /^store-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().slice(0, -keep).forEach(f => fs.unlinkSync(path.join(dir, 'backups', f)));}
  }
  const touch = () => {dirty = true;clearTimeout(timer);timer = setTimeout(flush, 500);};
  const alive = k => {if (EXP[k] && EXP[k] < Date.now()){delete KV[k];delete H[k];delete L[k];delete EXP[k];return false;}return true;};
  function run(c){
    if (!Array.isArray(c) || !c.length) throw new Error('bad command');
    const op = String(c[0]).toUpperCase(), a = c.slice(1).map(x => x == null ? x : String(x));
    switch (op){
      case 'PING': return 'PONG';
      case 'GET': return alive(a[0]) && KV[a[0]] != null ? KV[a[0]] : null;
      case 'SET': {if (a.includes('NX') && alive(a[0]) && KV[a[0]] != null) return null;KV[a[0]] = a[1];delete EXP[a[0]];touch();return 'OK';}
      case 'DEL': {let n = 0;a.forEach(k => {if (k in KV || k in H || k in L){n++;delete KV[k];delete H[k];delete L[k];delete EXP[k];}});touch();return n;}
      case 'INCR': {alive(a[0]);const v = (parseInt(KV[a[0]] || '0', 10) || 0) + 1;KV[a[0]] = String(v);touch();return v;}
      case 'EXPIRE': {EXP[a[0]] = Date.now() + (+a[1]) * 1000;touch();return 1;}
      case 'HSET': {const h = H[a[0]] = H[a[0]] || {};let n = 0;for (let i = 1; i + 1 < a.length; i += 2){if (!(a[i] in h)) n++;h[a[i]] = a[i + 1];}touch();return n;}
      case 'HGET': return (H[a[0]] || {})[a[1]] ?? null;
      case 'HDEL': {const h = H[a[0]] || {};let n = 0;a.slice(1).forEach(f => {if (f in h){delete h[f];n++;}});touch();return n;}
      case 'HGETALL': return Object.entries(H[a[0]] || {}).flat();
      case 'HKEYS': return Object.keys(H[a[0]] || {});
      case 'RPUSH': {const l = L[a[0]] = L[a[0]] || [];a.slice(1).forEach(v => l.push(v));touch();return l.length;}
      case 'LSET': {const l = L[a[0]] || [];l[+a[1] < 0 ? l.length + (+a[1]) : +a[1]] = a[2];touch();return 'OK';}
      case 'LLEN': return (L[a[0]] || []).length;
      case 'LRANGE': {const l = L[a[0]] || [];let s = +a[1], e = +a[2];if (s < 0) s = Math.max(0, l.length + s);if (e < 0) e = l.length + e;return l.slice(s, e + 1);}
      case 'EVAL': {
        // 변경 원장 스크립트만 지원 (api/_lib/core.js 의 LEDGER_LUA)
        const script = a[0];if (!/sys:ledger|redis\.sha1hex/.test(script) && !/RPUSH/.test(script)) throw new Error('EVAL: 지원하지 않는 스크립트');
        const nk = +a[1], keys = a.slice(2, 2 + nk), argv = a.slice(2 + nk);
        const head = KV[keys[0]] ?? 'GENESIS';const n = crypto.createHash('sha1').update(head + '|' + argv[0]).digest('hex');
        (L[keys[1]] = L[keys[1]] || []).push(n + '|' + head + '|' + argv[0]);KV[keys[0]] = n;touch();return n;
      }
      case 'KEYS': {const all = [...new Set([...Object.keys(KV), ...Object.keys(H), ...Object.keys(L)])].filter(alive);const pat = a[0] || '*';
        const re = new RegExp('^' + pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');return all.filter(k => re.test(k));}
      case 'TYPE': return a[0] in H ? 'hash' : a[0] in L ? 'list' : a[0] in KV ? 'string' : 'none';
      default: throw new Error('지원하지 않는 명령: ' + op);
    }
  }
  const token = opts.token || crypto.randomBytes(24).toString('hex');
  const srv = http.createServer((q, r) => {
    let b = '';q.on('data', c => {b += c;if (b.length > 8e6) q.destroy();});
    q.on('end', () => {
      r.setHeader('Content-Type', 'application/json');
      if ((q.headers.authorization || '') !== 'Bearer ' + token){r.statusCode = 401;return r.end(JSON.stringify({error:'unauthorized'}));}
      let c;try{c = JSON.parse(b);}catch(e){r.statusCode = 400;return r.end(JSON.stringify({error:'bad json'}));}
      const one = x => {try{return {result:run(x)};}catch(e){return {error:e.message};}};
      r.end(JSON.stringify(q.url.startsWith('/pipeline') ? c.map(one) : one(c)));
    });
  });
  process.on('exit', flush);['SIGINT', 'SIGTERM'].forEach(s => process.on(s, () => {flush();process.exit(0);}));
  return {
    run, flush, token,
    dump:() => ({v:1, at:Date.now(), H, KV, L, EXP}),
    load:j => {H = j.H || {};KV = j.KV || {};L = j.L || {};EXP = j.EXP || {};dirty = true;flush();},
    listen:() => new Promise(res => srv.listen(0, '127.0.0.1', () => res(`http://127.0.0.1:${srv.address().port}`)))
  };
}
module.exports = {createStore};
