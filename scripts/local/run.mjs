// 로컬 실행: 미니 Supabase → .env.local → (필요하면) 빌드 → 웹 서버 → 브라우저
// 사용: node scripts/local/run.mjs [--rebuild] [--no-open]
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLocalSupabase } from './local-supabase.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
process.chdir(root);
// 다른 프로젝트(예: 3000번)와 겹치지 않도록 비어 있는 포트를 찾아 씀
function isFree(port) {
  return new Promise((ok) => {
    const s = net.createServer();
    s.once('error', () => ok(false));
    s.once('listening', () => s.close(() => ok(true)));
    s.listen(port, '0.0.0.0');
  });
}
async function freePort(from) {
  for (let p = from; p < from + 50; p++) if (await isFree(p)) return p;
  throw new Error(`${from}~${from + 49} 포트가 모두 사용 중입니다`);
}
const WEB_PORT = await freePort(Number(process.env.PORT || 3210));
const SB_PORT = await freePort(54331);
const DEMO_PW = 'eum-local-2026';
const isWin = process.platform === 'win32';
const say = (...m) => console.log(...m);

say('\n▶ 로컬 DB·로그인 서버 시작');
let sb;
try {
  sb = await startLocalSupabase({ root, port: SB_PORT, demoPassword: DEMO_PW, log: say });
} catch (e) {
  say('  [실패] ' + (e.stack || e.message));
  process.exit(1);
}
say(`  ${sb.url}`);

// .env.local (수집 토큰은 유지)
let token = '';
if (fs.existsSync('.env.local')) token = (fs.readFileSync('.env.local', 'utf8').match(/^UMJI_INGEST_TOKENS=HC:(.+)$/m) || [])[1] || '';
if (!token) token = crypto.randomBytes(18).toString('hex');
const env = [
  `NEXT_PUBLIC_SUPABASE_URL=${sb.url}`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY=${sb.anonKey}`,
  `SUPABASE_SERVICE_ROLE_KEY=${sb.serviceKey}`,
  `UMJI_INGEST_TOKENS=HC:${token}`,
  '',
].join('\n');
fs.writeFileSync('.env.local', env);

// 빌드 필요 여부: 빌드가 없거나, 접속 키가 바뀌었거나, 소스가 빌드보다 새로우면
const stamp = path.join('.next', 'local-env.sha');
const envHash = crypto.createHash('sha256').update(env).digest('hex');
function newest(dir) {
  let t = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    t = Math.max(t, e.isDirectory() ? newest(p) : fs.statSync(p).mtimeMs);
  }
  return t;
}
let needBuild = process.argv.includes('--rebuild') || !fs.existsSync(path.join('.next', 'BUILD_ID')) || !fs.existsSync(stamp) || fs.readFileSync(stamp, 'utf8') !== envHash;
if (!needBuild) {
  const built = fs.statSync(path.join('.next', 'BUILD_ID')).mtimeMs;
  const src = Math.max(newest('app'), newest('lib'), newest('components'), fs.statSync('middleware.ts').mtimeMs);
  needBuild = src > built;
}
const nextBin = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next');
if (needBuild) {
  say('\n▶ 웹 빌드 (1~2분)');
  const r = spawnSync(process.execPath, [nextBin, 'build'], { stdio: 'inherit', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } });
  if (r.status !== 0) {
    say('  [실패] 빌드 오류. 위 내용을 알려주세요.');
    await sb.close();
    process.exit(1);
  }
  fs.writeFileSync(stamp, envHash);
}

say('\n=================================================================');
say('  강원 먹거리 이음 · 로컬 실행 (Docker 없이)');
say(`  주소       http://localhost:${WEB_PORT}`);
say(`  비밀번호   ${DEMO_PW}  (모든 데모 계정 공통)`);
say('  홍천센터   hongcheon@demo.eum      홍천초 영양교사  s101@demo.eum');
say('  공급업체   p01@demo.eum            도 관리자        province@demo.eum');
say('  춘천센터   chuncheon@demo.eum');
say(`  umji 수집 토큰  ${token}`);
say('  데이터 저장 위치  .localdb 폴더 (지우면 처음 상태로 돌아갑니다)');
say('  끝내려면 이 창을 닫거나 Ctrl+C');
say('=================================================================\n');

const web = spawn(process.execPath, [nextBin, 'start', '-p', String(WEB_PORT)], { stdio: 'inherit', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } });
if (!process.argv.includes('--no-open')) {
  setTimeout(() => {
    const u = `http://localhost:${WEB_PORT}`;
    if (isWin) spawn('cmd', ['/c', 'start', '', u], { stdio: 'ignore', detached: true });
    else if (process.platform === 'darwin') spawn('open', [u], { stdio: 'ignore', detached: true });
  }, 3000);
}
const stop = async () => {
  web.kill();
  await sb.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
web.on('exit', async (code) => {
  if (code) say(`  웹 서버가 종료되었습니다 (코드 ${code}). 실행 창의 오류 내용을 확인하세요.`);
  await sb.close();
  process.exit(code ?? 0);
});
