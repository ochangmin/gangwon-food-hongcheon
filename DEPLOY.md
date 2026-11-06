# 인터넷 배포 (Supabase + Vercel)

## 1. Supabase (DB·로그인)
1. https://supabase.com 에서 New project 생성 (Region: Northeast Asia (Seoul))
2. 왼쪽 **SQL Editor → New query** 에 `supabase/setup-all.sql` 전체를 붙여넣고 **Run**
   - 테이블·권한·업무 함수·예시 데이터·데모 계정 5개가 한 번에 만들어집니다.
3. **Project Settings → API** 에서 세 값을 복사해 둡니다.
   - Project URL
   - anon (또는 publishable) key
   - service_role (또는 secret) key  ← 외부에 노출 금지
4. **Authentication → Sign In / Providers** 에서 "Allow new users to sign up" 을 끕니다 (계정은 센터가 발급).

## 2. Vercel (웹)
1. https://vercel.com/new 에서 이 GitHub 저장소를 Import
2. Environment Variables 에 입력
   | 이름 | 값 |
   |---|---|
   | NEXT_PUBLIC_SUPABASE_URL | Project URL |
   | NEXT_PUBLIC_SUPABASE_ANON_KEY | anon / publishable key |
   | SUPABASE_SERVICE_ROLE_KEY | service_role / secret key |
   | UMJI_INGEST_TOKENS | `HC:24자 이상 임의 문자열` |
3. Deploy → `https://<프로젝트>.vercel.app` 으로 접속

## 3. 도메인 (급식.shop)
Vercel 프로젝트 → Settings → Domains 에 `급식.shop` 추가 → 안내되는 A/CNAME 값을 가비아 DNS 관리에 입력.
(한글 도메인은 퓨니코드 `xn--...` 로 표시될 수 있습니다)

## 데모 계정
province@eum.demo · hongcheon@eum.demo · chuncheon@eum.demo · s101@eum.demo · p01@eum.demo
비밀번호는 setup-all.sql 의 `declare pw text := '...'` 값입니다. 실제 운영 전 비밀번호를 바꾸거나 데모 계정을 지우세요.
