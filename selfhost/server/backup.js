// 자료 백업·복원 도구
//   node server/backup.js export 파일.json            내장 저장소(storage/store.json) → 파일
//   node server/backup.js export 파일.json --upstash  Vercel 의 Upstash → 파일 (UPSTASH_URL, UPSTASH_TOKEN 필요)
//   node server/backup.js import 파일.json            파일 → 내장 저장소 (서버를 멈춘 뒤 실행)
// 백업 파일에는 암호화된 자료와 함께 복호화 키(sys:dek)·비밀번호 해시가 들어 있으니 안전한 곳에 보관하세요.
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');const STORAGE = path.resolve(ROOT, process.env.STORAGE_DIR || 'storage');
const [, , cmd, file, flag] = process.argv;
async function up(cmd){const r = await fetch(process.env.UPSTASH_URL, {method:'POST', headers:{Authorization:'Bearer ' + process.env.UPSTASH_TOKEN, 'Content-Type':'application/json'}, body:JSON.stringify(cmd)});const j = await r.json();if (j.error) throw new Error(j.error);return j.result;}
(async () => {
  if (cmd === 'export' && file){
    let dump;
    if (flag === '--upstash'){
      if (!process.env.UPSTASH_URL || !process.env.UPSTASH_TOKEN) throw new Error('UPSTASH_URL, UPSTASH_TOKEN 환경변수를 넣으세요 (Vercel → Storage → 데이터베이스 → .env.local 탭의 KV_REST_API_URL / KV_REST_API_TOKEN)');
      dump = {v:1, at:Date.now(), H:{}, KV:{}, L:{}, EXP:{}};const keys = await up(['KEYS', '*']);
      for (const k of keys){if (/^rl/.test(k)) continue;const t = await up(['TYPE', k]);
        if (t === 'hash'){const f = await up(['HGETALL', k]);dump.H[k] = {};for (let i = 0; i < f.length; i += 2) dump.H[k][f[i]] = f[i + 1];}
        else if (t === 'list') dump.L[k] = await up(['LRANGE', k, '0', '-1']);else if (t === 'string') dump.KV[k] = await up(['GET', k]);}
    } else dump = JSON.parse(fs.readFileSync(path.join(STORAGE, 'store.json'), 'utf8'));
    fs.writeFileSync(file, JSON.stringify(dump), {mode:0o600});
    console.log(`백업 완료: ${file} · 컬렉션 ${Object.keys(dump.H).length}개 · 값 ${Object.keys(dump.KV).length}개 · 목록 ${Object.keys(dump.L).length}개`);
  } else if (cmd === 'import' && file){
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));fs.mkdirSync(STORAGE, {recursive:true});
    const cur = path.join(STORAGE, 'store.json');if (fs.existsSync(cur)) fs.copyFileSync(cur, cur + '.before-import-' + Date.now());
    fs.writeFileSync(cur, JSON.stringify(Object.assign({v:1}, j, {at:Date.now()})), {mode:0o600});
    console.log(`복원 완료 → ${cur} (이전 파일은 .before-import-* 로 보관). 서버를 다시 시작하세요.`);
  } else {console.log('사용법: node server/backup.js export|import 파일.json [--upstash]');process.exit(1);}
})().catch(e => {console.error('실패:', e.message);process.exit(1);});
