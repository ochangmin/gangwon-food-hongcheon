# 강원 먹거리 이음 — 자체 설치형 서버

Vercel·Upstash 없이 **PC나 서버 한 대**에서 급식.shop과 같은 시스템을 그대로 운영하는 패키지입니다.
화면, 서버 API, 회원 로그인, 저장소가 모두 들어 있습니다.

| 들어 있는 것 | 설명 |
|---|---|
| 화면 (`public/`) | 메인·관제·배송·입출고·일일 관리·서류·판매 실적·회원 관리 등 전체 화면 |
| 서버 (`server/server.js`) | 화면 제공, 회원 로그인 관문, API, 보안 헤더 |
| API (`api/`) | 회원·로그인, 업무 자료, 변경 원장(위·변조 확인) — 급식.shop과 같은 코드 |
| 내장 저장소 (`server/store.js`) | 자료를 `storage/store.json` 에 암호화해 저장, 하루 한 번 `storage/backups/` 에 자동 사본 |
| 백업 도구 (`server/backup.js`) | 자료 내보내기·가져오기, Vercel(Upstash) 자료 옮겨 오기 |

필요한 것: **Node.js 18 이상** (추가 설치 패키지 없음), 인터넷(지도 배경 타일용).

---

## 1. 윈도우에 설치

1. 압축을 풀어 폴더를 둡니다. 예: `C:\gwfood`
2. **`설치_윈도우.bat`** 실행 → Node.js가 없으면 설치 후 한 번 더 실행합니다. `.env` 설정 파일이 만들어집니다.
   - 다른 PC에서 접속하게 하려면 **관리자 권한으로 실행**(방화벽 8080 포트 열기).
3. **`실행_윈도우.bat`** 실행 → 창에 **최초 설정 코드**가 나옵니다 (`storage\setup-code.txt` 에도 있음).
4. 브라우저에서 `http://localhost:8080` → 로그인 화면에서 최초 설정 코드로 **관리자 계정**을 만듭니다.
5. 윈도우가 켜질 때 자동으로 시작하려면 **`자동시작등록_윈도우.bat`** 을 관리자 권한으로 실행합니다.

## 2. 리눅스 서버에 설치 (Ubuntu 등)

```bash
unzip gwfood-server.zip && cd gwfood
./install_linux.sh          # systemd 서비스(gwfood)로 등록·시작
sudo journalctl -u gwfood -f   # 로그 · 최초 설정 코드 확인
```

## 3. Docker로 설치

```bash
cp .env.example .env
docker compose up -d
docker logs gwfood            # 최초 설정 코드 확인
```
자료는 `./storage` 폴더에 남습니다.

---

## 4. 운영 설정 (`.env`)

| 항목 | 기본 | 설명 |
|---|---|---|
| `PORT` | 8080 | 접속 포트 |
| `STORAGE_DIR` | storage | 자료 저장 폴더 — **이 폴더가 곧 DB**입니다 |
| `BACKUP_KEEP_DAYS` | 30 | 자동 백업 보관 일수 |
| `TLS_CERT`, `TLS_KEY` | – | HTTPS 인증서 경로 (있으면 https로 시작) |
| `TRUST_PROXY` | 0 | Nginx·Caddy·IIS 같은 HTTPS 프록시 뒤에서 운영하면 1 |
| `DATA_ENC_KEY` | 자동 | 자료 암호화 키. 비우면 자동 생성되어 저장소에 함께 보관. 따로 두려면 직접 지정 |
| `ADMIN_SETUP_CODE` | 자동 | 최초 관리자 설정 코드 |
| `VWORLD_KEY` | – | 브이월드 항공영상 키 (이 서버 주소로 발급). 없으면 Esri 영상 |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | – | 외부 Upstash를 계속 쓸 때만 |

**인터넷에 공개할 때는 반드시 HTTPS**로 운영하세요. 인증서를 직접 넣거나, Caddy(자동 인증서) 같은 프록시 뒤에 두고 `TRUST_PROXY=1` 로 설정합니다.
http로 시작하면 로그인 쿠키의 보안 표시(Secure)를 끄고 동작하므로 **내부망 시험용**으로만 쓰세요.

Caddy 예시 (`Caddyfile`):
```
급식.example.kr {
  reverse_proxy 127.0.0.1:8080
}
```

## 5. 백업과 복원

- **자동**: 하루 한 번 `storage/backups/store-날짜.json` (30일 보관).
- **수동**: `자료백업_윈도우.bat` 또는 `node server/backup.js export 백업.json`
- **복원**: 서버를 멈추고 `node server/backup.js import 백업.json` → 다시 시작.
- **급식.shop(Vercel·Upstash) 자료 옮겨 오기**:
  1. Vercel → Storage → 데이터베이스 → `.env.local` 탭에서 `KV_REST_API_URL`, `KV_REST_API_TOKEN` 값을 확인
  2. `UPSTASH_URL=값 UPSTASH_TOKEN=값 node server/backup.js export 급식shop.json --upstash`
     (윈도우: `set UPSTASH_URL=값` · `set UPSTASH_TOKEN=값` 후 실행)
  3. 새 서버에서 `node server/backup.js import 급식shop.json` → 계정·자료가 그대로 옮겨집니다.

> 백업 파일과 `storage` 폴더에는 암호화된 자료와 함께 **복호화 키·비밀번호 해시**가 들어 있습니다. 외부로 보내지 말고 안전한 곳에 보관하세요.

## 6. 계정

- 첫 관리자는 최초 설정 코드로 만들고, 이후 계정은 **회원 관리** 탭에서 발급합니다 (센터 관리자·센터 직원·열람 전용·공급업체·배송 기사·학교).
- 관리자 비밀번호를 잊으면 다른 관리자가 초기화할 수 있습니다. **관리자를 2명 이상** 두세요.

## 7. 알아 둘 점

- **기사 앱(APK)** 은 급식.shop 주소로 만들어져 있습니다. 새 주소로 쓰려면 원본(`android/`)의 `MainActivity.java` 에서 `HOST`·`HOME` 을 바꿔 다시 빌드합니다.
- **umji 출고 수집기**(`collector`)는 Claude 버전 대시보드로 보냅니다. 이 서버로 보내려면 설정의 보낼 곳을 바꿔야 합니다.
- 지도 배경(위성·도로), 도로 경로 계산(OSRM), 글꼴은 인터넷에서 받아 옵니다. 그 밖의 화면·자료·로그인은 모두 이 서버 안에서 동작합니다.
- 화면을 고치고 다시 만들 때는 백업의 `소스/` 폴더 안내(`소스/빌드안내.md`)를 따릅니다.
