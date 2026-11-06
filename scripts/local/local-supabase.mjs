// Docker 없이 PC에서 돌아가는 미니 Supabase
// - DB: PGlite (Postgres를 Node 안에서 실행, .localdb 폴더에 저장)
// - REST: supabase-js가 쓰는 PostgREST 문법 중 이 앱이 쓰는 부분 (select·embed·필터·정렬·insert·update·delete·rpc)
// - Auth: 이메일/비밀번호 로그인, 토큰 갱신, 사용자 조회, 관리자 계정 생성
// 모든 요청은 로그인 사용자의 역할로 실행되므로 RLS 권한 규칙이 Supabase와 똑같이 적용됩니다.
import { PGlite } from '@electric-sql/pglite';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const b64u = (b) => Buffer.from(b).toString('base64url');
const IDENT = /^[a-z_][a-z0-9_]*$/;
const q = (id) => {
  if (!IDENT.test(id)) throw httpErr(400, 'PGRST100', `잘못된 이름: ${id}`);
  return `"${id}"`;
};
function httpErr(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

export async function startLocalSupabase({ root, port = 54321, demoPassword = 'eum-local-2026', log = console.log }) {
  const stateDir = path.join(root, '.localdb');
  const secretFile = path.join(root, '.localdb-secret.json');
  const fresh = !fs.existsSync(path.join(stateDir, 'PG_VERSION'));
  fs.mkdirSync(stateDir, { recursive: true });

  let secret;
  if (fs.existsSync(secretFile)) secret = JSON.parse(fs.readFileSync(secretFile, 'utf8'));
  else {
    secret = { jwt: crypto.randomBytes(32).toString('hex') };
    fs.writeFileSync(secretFile, JSON.stringify(secret));
  }
  const sign = (payload) => {
    const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const p = b64u(JSON.stringify(payload));
    const s = crypto.createHmac('sha256', secret.jwt).update(`${h}.${p}`).digest('base64url');
    return `${h}.${p}.${s}`;
  };
  const verify = (tok) => {
    const [h, p, s] = String(tok || '').split('.');
    if (!h || !p || !s) return null;
    const exp = crypto.createHmac('sha256', secret.jwt).update(`${h}.${p}`).digest('base64url');
    if (exp.length !== s.length || !crypto.timingSafeEqual(Buffer.from(exp), Buffer.from(s))) return null;
    const c = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (c.exp && c.exp < Date.now() / 1000) return null;
    return c;
  };
  const anonKey = sign({ iss: 'eum-local', role: 'anon' });
  const serviceKey = sign({ iss: 'eum-local', role: 'service_role' });

  const db = new PGlite(stateDir);
  await db.waitReady;

  // ---------- 초기화·마이그레이션 ----------
  await db.exec(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    end $$;
    create schema if not exists auth;
    create table if not exists auth.users (
      id uuid primary key default gen_random_uuid(), email text unique not null, encrypted_password text not null,
      created_at timestamptz not null default now(), last_sign_in_at timestamptz);
    create table if not exists auth.refresh_tokens (token text primary key, user_id uuid not null references auth.users(id) on delete cascade, created_at timestamptz default now());
    create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    grant execute on function auth.uid() to authenticated, anon;
    create schema if not exists _local;
    create table if not exists _local.migrations (name text primary key, applied_at timestamptz default now());
  `);
  const migDir = path.join(root, 'supabase', 'migrations');
  const done = new Set((await db.query('select name from _local.migrations')).rows.map((r) => r.name));
  for (const f of fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(migDir, f), 'utf8').replace(/create extension if not exists pgcrypto;/g, '');
    await db.exec(sql);
    await db.query('insert into _local.migrations(name) values ($1)', [f]);
    log(`  DB 반영: ${f}`);
  }
  const hash = (pw) => {
    const salt = crypto.randomBytes(16).toString('hex');
    return `scrypt$${salt}$${crypto.scryptSync(pw, salt, 32).toString('hex')}`;
  };
  const checkPw = (pw, stored) => {
    const [, salt, h] = String(stored).split('$');
    if (!salt || !h) return false;
    const got = crypto.scryptSync(pw, salt, 32);
    return crypto.timingSafeEqual(got, Buffer.from(h, 'hex'));
  };
  if (fresh) {
    await db.exec(fs.readFileSync(path.join(root, 'supabase', 'seed.sql'), 'utf8'));
    const HC = '11111111-0000-0000-0000-000000000001', CC = '11111111-0000-0000-0000-000000000002';
    const idOf = async (t, c, code) => (await db.query(`select id from public.${t} where center_id=$1 and code=$2`, [c, code])).rows[0]?.id ?? null;
    const demo = [
      ['province@demo.eum', '도 급식담당', 'province_admin', null, null, null],
      ['hongcheon@demo.eum', '홍천센터 관리자', 'center_admin', HC, null, null],
      ['chuncheon@demo.eum', '춘천센터 관리자', 'center_admin', CC, null, null],
      ['s101@demo.eum', '홍천초 영양교사', 'school', HC, await idOf('schools', HC, 'S101'), null],
      ['p01@demo.eum', '내면 고랭지작목반', 'supplier', HC, null, await idOf('suppliers', HC, 'P01')],
    ];
    for (const [email, name, role, c, s, p] of demo) {
      const u = (await db.query('insert into auth.users(email, encrypted_password) values ($1,$2) returning id', [email, hash(demoPassword)])).rows[0];
      await db.query('insert into public.profiles(id,name,role,center_id,school_id,supplier_id) values ($1,$2,$3,$4,$5,$6)', [u.id, name, role, c, s, p]);
    }
    log('  예시 데이터와 데모 계정을 만들었습니다');
  }

  // ---------- 카탈로그 (embed 관계) ----------
  const fks = (await db.query(`
    select replace(c.conrelid::regclass::text,'public.','') src, a.attname col,
           replace(c.confrelid::regclass::text,'public.','') dst, af.attname refcol
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    join pg_attribute af on af.attrelid = c.confrelid and af.attnum = c.confkey[1]
    where c.contype = 'f' and c.connamespace = 'public'::regnamespace and array_length(c.conkey, 1) = 1`)).rows;
  const relations = new Set((await db.query(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r','v','m')`)).rows.map((r) => r.relname));
  // 필터 값은 문자열로 받아 컬럼 타입으로 변환
  const colTypes = new Map();
  for (const r of (await db.query(`
    select c.relname, a.attname, format_type(a.atttypid, a.atttypmod) t
    from pg_attribute a join pg_class c on c.oid = a.attrelid
    where c.relnamespace = 'public'::regnamespace and a.attnum > 0 and not a.attisdropped`)).rows) {
    if (!colTypes.has(r.relname)) colTypes.set(r.relname, new Map());
    colTypes.get(r.relname).set(r.attname, r.t);
  }
  const procs = new Map();
  for (const r of (await db.query(`
    select p.proname, p.proretset, format_type(p.prorettype, null) rettype, p.proargnames,
           array(select format_type(t, null) from unnest(p.proargtypes) t) argtypes
    from pg_proc p where p.pronamespace = 'public'::regnamespace`)).rows) procs.set(r.proname, r);

  // ---------- PostgREST select 파서 ----------
  function parseSelect(s) {
    const items = [];
    let i = 0;
    function list(end) {
      const out = [];
      let tok = '';
      while (i < s.length) {
        const ch = s[i];
        if (ch === '(') {
          i++;
          const children = list(')');
          const [alias, name] = tok.includes(':') ? tok.split(':') : [null, tok];
          out.push({ type: 'embed', name: name.trim().split('!')[0], alias: alias?.trim() || null, children });
          tok = '';
          continue;
        }
        if (ch === ')' && end === ')') { i++; break; }
        if (ch === ',') { if (tok.trim()) out.push(colItem(tok)); tok = ''; i++; continue; }
        tok += ch;
        i++;
      }
      if (tok.trim()) out.push(colItem(tok));
      return out;
    }
    function colItem(t) {
      t = t.trim();
      if (t === '*') return { type: 'star' };
      const [alias, name] = t.includes(':') ? t.split(':') : [null, t];
      return { type: 'col', name: name.trim().split('::')[0], alias: alias?.trim() || null };
    }
    items.push(...list(null));
    return items;
  }
  let seq = 0;
  function selectList(table, alias, items) {
    return items.map((it) => {
      if (it.type === 'star') return `${alias}.*`;
      if (it.type === 'col') return `${alias}.${q(it.name)} as ${q(it.alias || it.name)}`;
      const E = it.name;
      if (!relations.has(E)) throw httpErr(400, 'PGRST200', `${table}와 ${E} 사이의 관계를 찾을 수 없습니다`);
      const sub = `e${++seq}`, j = `j${seq}`;
      const inner = selectList(E, sub, it.children.length ? it.children : [{ type: 'star' }]);
      const m2o = fks.find((f) => f.src === table && f.dst === E);
      if (m2o) return `(select to_json(${j}) from (select ${inner} from public.${q(E)} ${sub} where ${sub}.${q(m2o.refcol)} = ${alias}.${q(m2o.col)}) ${j}) as ${q(it.alias || E)}`;
      const o2m = fks.find((f) => f.src === E && f.dst === table);
      if (o2m) return `(select coalesce(json_agg(${j}), '[]'::json) from (select ${inner} from public.${q(E)} ${sub} where ${sub}.${q(o2m.col)} = ${alias}.${q(o2m.refcol)}) ${j}) as ${q(it.alias || E)}`;
      throw httpErr(400, 'PGRST200', `${table}와 ${E} 사이의 관계를 찾을 수 없습니다`);
    }).join(', ');
  }

  // ---------- 필터 ----------
  const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'columns', 'on_conflict']);
  function splitList(v) {
    const out = [];
    let cur = '', inq = false;
    for (let i = 0; i < v.length; i++) {
      const ch = v[i];
      if (ch === '"') { inq = !inq; continue; }
      if (ch === ',' && !inq) { out.push(cur); cur = ''; continue; }
      cur += ch;
    }
    out.push(cur);
    return out;
  }
  function where(params, alias, args, table) {
    const conds = [];
    for (const [k, raw] of params) {
      if (RESERVED.has(k)) continue;
      let v = raw, neg = false;
      if (v.startsWith('not.')) { neg = true; v = v.slice(4); }
      const dot = v.indexOf('.');
      const op = v.slice(0, dot), val = v.slice(dot + 1);
      const col = `${alias}.${q(k)}`;
      const type = colTypes.get(table)?.get(k);
      if (!type) throw httpErr(400, '42703', `${table}.${k} 컬럼이 없습니다`);
      const p = () => { args.push(val); return `$${args.length}::text::${type}`; };
      let c;
      switch (op) {
        case 'eq': c = `${col} = ${p()}`; break;
        case 'neq': c = `${col} <> ${p()}`; break;
        case 'gt': c = `${col} > ${p()}`; break;
        case 'gte': c = `${col} >= ${p()}`; break;
        case 'lt': c = `${col} < ${p()}`; break;
        case 'lte': c = `${col} <= ${p()}`; break;
        case 'like': c = `${col}::text like ${p()}`; break;
        case 'ilike': c = `${col}::text ilike ${p()}`; break;
        case 'is': {
          const m = { null: 'null', true: 'true', false: 'false', unknown: 'unknown' }[val.toLowerCase()];
          if (!m) throw httpErr(400, 'PGRST100', `is 값 오류: ${val}`);
          c = `${col} is ${m}`;
          break;
        }
        case 'in': {
          const list = splitList(val.replace(/^\(/, '').replace(/\)$/, ''));
          args.push(list);
          c = `${col}::text = any(${'$' + args.length}::text[])`;
          break;
        }
        default: throw httpErr(400, 'PGRST100', `지원하지 않는 필터: ${op}`);
      }
      conds.push(neg ? `not (${c})` : c);
    }
    return conds.length ? conds.join(' and ') : 'true';
  }
  function orderBy(v, alias) {
    if (!v) return '';
    return ' order by ' + v.split(',').map((part) => {
      const [col, dir, nulls] = part.split('.');
      return `${alias}.${q(col)} ${dir === 'desc' ? 'desc' : 'asc'}${nulls === 'nullsfirst' ? ' nulls first' : nulls === 'nullslast' ? ' nulls last' : ''}`;
    }).join(', ');
  }

  // ---------- 실행 컨텍스트 ----------
  function identify(req) {
    const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const c = verify(bearer) || verify(req.headers.apikey);
    if (!c) return null;
    return { role: c.role, sub: c.sub || null };
  }
  async function asRole(ident, fn) {
    return db.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true), set_config('request.jwt.claim.role', $3, true)`,
        [JSON.stringify({ role: ident.role, sub: ident.sub }), ident.sub || '', ident.role]);
      if (ident.role !== 'service_role') await tx.exec(`set local role ${ident.role === 'authenticated' ? 'authenticated' : 'anon'}`);
      return fn(tx);
    });
  }

  const userJson = (u) => ({
    id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: u.created_at,
    app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [],
    created_at: u.created_at, updated_at: u.created_at, last_sign_in_at: u.last_sign_in_at,
  });
  async function session(u) {
    const now = Math.floor(Date.now() / 1000);
    const refresh = crypto.randomBytes(24).toString('hex');
    await db.query('insert into auth.refresh_tokens(token, user_id) values ($1,$2)', [refresh, u.id]);
    return {
      access_token: sign({ iss: 'eum-local', aud: 'authenticated', role: 'authenticated', sub: u.id, email: u.email, iat: now, exp: now + 3600 }),
      token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: refresh, user: userJson(u),
    };
  }

  // ---------- HTTP ----------
  const server = http.createServer(async (req, res) => {
    const send = (status, body, headers = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', ...headers });
      res.end(body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body));
    };
    try {
      if (req.method === 'OPTIONS') {
        return send(204, undefined, { 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS' });
      }
      const url = new URL(req.url, 'http://x');
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const raw = Buffer.concat(chunks).toString('utf8');
      const body = raw ? JSON.parse(raw) : null;
      const ident = identify(req);
      if (!ident) return send(401, { code: 'PGRST301', message: 'API 키가 올바르지 않습니다' });

      // ----- auth -----
      if (url.pathname === '/auth/v1/token' && req.method === 'POST') {
        const grant = url.searchParams.get('grant_type');
        let u;
        if (grant === 'password') {
          u = (await db.query('select * from auth.users where lower(email) = lower($1)', [body?.email || ''])).rows[0];
          if (!u || !checkPw(String(body?.password || ''), u.encrypted_password)) {
            return send(400, { code: 'invalid_credentials', error_code: 'invalid_credentials', msg: 'Invalid login credentials', error: 'invalid_grant', error_description: 'Invalid login credentials' });
          }
          await db.query('update auth.users set last_sign_in_at = now() where id = $1', [u.id]);
        } else if (grant === 'refresh_token') {
          const r = (await db.query('delete from auth.refresh_tokens where token = $1 returning user_id', [body?.refresh_token || ''])).rows[0];
          if (!r) return send(400, { code: 'refresh_token_not_found', error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' });
          u = (await db.query('select * from auth.users where id = $1', [r.user_id])).rows[0];
        } else return send(400, { msg: '지원하지 않는 grant_type' });
        return send(200, await session(u));
      }
      if (url.pathname === '/auth/v1/user' && req.method === 'GET') {
        if (ident.role !== 'authenticated') return send(403, { code: 'no_authorization', error_code: 'no_authorization', msg: 'This endpoint requires a valid Bearer token' });
        const u = (await db.query('select * from auth.users where id = $1', [ident.sub])).rows[0];
        if (!u) return send(403, { code: 'user_not_found', error_code: 'user_not_found', msg: 'User from sub claim in JWT does not exist' });
        return send(200, userJson(u));
      }
      if (url.pathname === '/auth/v1/logout') {
        if (ident.sub) await db.query('delete from auth.refresh_tokens where user_id = $1', [ident.sub]);
        return send(204);
      }
      if (url.pathname.startsWith('/auth/v1/admin/users')) {
        if (ident.role !== 'service_role') return send(403, { msg: '관리자 키가 필요합니다' });
        const id = url.pathname.split('/')[5];
        if (req.method === 'POST' && !id) {
          if (!body?.email || !body?.password || String(body.password).length < 6) return send(422, { code: 'validation_failed', msg: '이메일과 6자 이상 비밀번호가 필요합니다' });
          try {
            const u = (await db.query('insert into auth.users(email, encrypted_password) values ($1,$2) returning *', [body.email, hash(String(body.password))])).rows[0];
            return send(200, userJson(u));
          } catch (e) {
            if (e.code === '23505') return send(422, { code: 'email_exists', error_code: 'email_exists', msg: '이미 등록된 이메일입니다' });
            throw e;
          }
        }
        if (req.method === 'DELETE' && id) {
          await db.query('delete from auth.users where id = $1', [id]);
          return send(200, {});
        }
        return send(404, { msg: 'not found' });
      }

      // ----- rpc -----
      const rpcM = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_][a-z0-9_]*)$/);
      if (rpcM) {
        const fn = procs.get(rpcM[1]);
        if (!fn) return send(404, { code: 'PGRST202', message: `함수 ${rpcM[1]}를 찾을 수 없습니다` });
        const names = fn.proargnames || [];
        const args = [], parts = [];
        for (const [k, v] of Object.entries(body || {})) {
          const idx = names.indexOf(k);
          if (idx < 0) return send(400, { code: 'PGRST202', message: `알 수 없는 인자: ${k}` });
          const type = fn.argtypes[idx];
          let val = v;
          if (v === null || v === undefined) val = null;
          else if (type.endsWith('[]') && Array.isArray(v)) val = '{' + v.map((x) => `"${String(x).replace(/(["\\])/g, '\\$1')}"`).join(',') + '}';
          else if (type === 'jsonb' || type === 'json') val = JSON.stringify(v);
          else val = String(v);
          args.push(val);
          parts.push(`${q(k)} => $${args.length}::text::${type}`);
        }
        const call = `public.${q(rpcM[1])}(${parts.join(', ')})`;
        const sql = fn.proretset || fn.rettype === 'record'
          ? `select coalesce(json_agg(r), '[]'::json) as data from ${call} r`
          : `select to_json(${call}) as data`;
        const out = await asRole(ident, (tx) => tx.query(sql, args));
        return send(200, JSON.stringify(out.rows[0].data ?? null));
      }

      // ----- table -----
      const tM = url.pathname.match(/^\/rest\/v1\/([a-z_][a-z0-9_]*)$/);
      if (!tM) return send(404, { message: '알 수 없는 경로' });
      const T = tM[1];
      if (!relations.has(T)) return send(404, { code: '42P01', message: `${T} 테이블이 없습니다` });
      const params = [...url.searchParams.entries()];
      const sel = parseSelect(url.searchParams.get('select') || '*');
      const wantObject = (req.headers.accept || '').includes('vnd.pgrst.object');
      const prefer = req.headers.prefer || '';
      const wantRows = prefer.includes('return=representation');
      const args = [];
      let sql;
      if (req.method === 'GET' || req.method === 'HEAD') {
        const lim = url.searchParams.get('limit'), off = url.searchParams.get('offset');
        sql = `select coalesce(json_agg(r), '[]'::json) as data from (select ${selectList(T, 't0', sel)} from public.${q(T)} t0 where ${where(params, 't0', args, T)}${orderBy(url.searchParams.get('order'), 't0')}${lim ? ` limit ${parseInt(lim, 10)}` : ''}${off ? ` offset ${parseInt(off, 10)}` : ''}) r`;
      } else if (req.method === 'POST') {
        const rows = Array.isArray(body) ? body : [body];
        const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
        args.push(JSON.stringify(rows));
        const cl = cols.map(q).join(', ');
        sql = `with ins as (insert into public.${q(T)} (${cl}) select ${cl} from json_populate_recordset(null::public.${q(T)}, $1::json) returning *)
               select coalesce(json_agg(r), '[]'::json) as data from (select ${selectList(T, 't0', sel)} from ins t0) r`;
      } else if (req.method === 'PATCH') {
        const cols = Object.keys(body || {});
        if (!cols.length) return send(400, { message: '변경할 값이 없습니다' });
        args.push(JSON.stringify(body));
        const w = where(params, 't0', args, T);
        sql = `with upd as (update public.${q(T)} t0 set ${cols.map((c) => `${q(c)} = x.${q(c)}`).join(', ')}
               from json_populate_record(null::public.${q(T)}, $1::json) x where ${w} returning t0.*)
               select coalesce(json_agg(r), '[]'::json) as data from (select ${selectList(T, 't0', sel)} from upd t0) r`;
      } else if (req.method === 'DELETE') {
        const w = where(params, 't0', args, T);
        sql = `with del as (delete from public.${q(T)} t0 where ${w} returning t0.*) select coalesce(json_agg(r), '[]'::json) as data from (select * from del t0) r`;
      } else return send(405, { message: '지원하지 않는 메서드' });

      const out = await asRole(ident, (tx) => tx.query(sql, args));
      const data = out.rows[0].data;
      if (req.method !== 'GET' && !wantRows) return send(req.method === 'POST' ? 201 : 204);
      if (wantObject) {
        if (data.length !== 1) return send(406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${data.length} rows`, hint: null });
        return send(req.method === 'POST' ? 201 : 200, data[0]);
      }
      return send(req.method === 'POST' ? 201 : 200, data);
    } catch (e) {
      const status = e.status || (e.code === '23505' ? 409 : e.code === '42501' ? 403 : e.code === '23503' ? 409 : 400);
      if (!e.status && !e.code) log('  [오류]', e);
      return send(status, { code: e.code ?? 'PGRST000', message: e.message, details: e.detail ?? null, hint: e.hint ?? null });
    }
  });
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', ok); });
  return {
    url: `http://127.0.0.1:${port}`, anonKey, serviceKey,
    async close() { server.close(); await db.close(); },
  };
}
