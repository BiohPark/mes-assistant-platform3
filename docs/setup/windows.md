# 실행 가이드 — Windows (기준)

이 저장소를 처음 받은 개발자·운영자가 **이 문서만 보고** 설치 → 로그인 → 빈 허브까지 가기 위한 안내다.
모든 명령은 **PowerShell** 기준이다(Windows Terminal 또는 VS Code 터미널). macOS 차이는 [macos.md](macos.md).

> 문서와 실제가 어긋나지 않도록, 이 문서에서 ` ```powershell ci ` 로 표시된 명령 블록은 CI의 Windows 잡(`setup-guide`)이 **그대로 실행**한다(`scripts/run-doc-commands.mjs`). GUI 설치·Docker·브라우저 로그인 단계는 사람이 확인한다.
> 명령이 바뀌면 이 문서를 **같은 커밋에서** 고친다.

현재 단계: **S1 진행 중** — 회원가입·로그인하면 빈 허브가 보인다. 에이전트·대화 기능은 S2부터.

---

## 1. 사전 준비물

| 준비물 | 버전 | 설치 (둘 중 하나) | 용도 |
|---|---|---|---|
| Git for Windows | 2.40 이상 | `winget install --id Git.Git -e` · [git-scm.com](https://git-scm.com/download/win) | 저장소 받기 |
| Node.js | **22.x** (22.12 이상) | nvm-windows: `winget install --id CoreyButler.NVMforWindows -e` 후 새 터미널에서 `nvm install 22` → `nvm use 22` · 또는 [nodejs.org](https://nodejs.org/)의 22.x 설치 파일 | api·web 실행 |
| pnpm | 10.x | Node 22에 포함된 corepack으로 (아래) | 패키지 관리 |
| MariaDB | **11.8 LTS** (10.4 이상) | (a) Docker로 띄우기 — 설치 불필요 · (b) 직접 설치: [mariadb.org 다운로드](https://mariadb.org/download/)의 Windows MSI(11.8) 또는 `winget install --id MariaDB.Server -e` | DB |
| Docker Desktop | 최신 | `winget install --id Docker.DockerDesktop -e` (WSL 2 필요, 설치 뒤 재부팅) | **개발용** Keycloak·가짜 OpenWebUI (·MariaDB) |

Node 23 이상은 쓰지 않는다(`engines`가 22로 고정). 여러 버전이 필요하면 nvm-windows로 전환한다.

pnpm 켜기 (저장소의 `packageManager` 버전을 자동으로 쓴다):

```powershell ci
corepack enable
```

> corepack이 권한 오류를 내면 관리자 PowerShell에서 한 번 실행하거나, 대신 `npm install -g pnpm@10`.

설치 확인 — 버전이 나오면 된다:

```powershell ci
git --version
node --version      # v22.x
pnpm --version      # 10.x
```

```powershell
mariadb --version   # (b) 직접 설치한 경우: mariadb from 11.8.x-MariaDB
docker --version    # Docker Desktop을 쓰는 경우
docker compose version
```

`mariadb`를 찾지 못하면 `C:\Program Files\MariaDB 11.8\bin`을 사용자 환경 변수 `Path`에 추가하고 터미널을 새로 연다.

## 2. 저장소 받기

Git 설정(한 번만) — 줄바꿈을 바꾸지 않고, 긴 경로를 허용한다:

```powershell ci
git config --global core.autocrlf false
git config --global core.longpaths true
```

- 저장소 파일은 모두 LF다(`.gitattributes`). `autocrlf=true`면 체크아웃 때 CRLF로 바뀌어 스크립트·스냅샷 비교가 어긋날 수 있다.
- Windows 긴 경로: `node_modules` 경로가 260자를 넘으면 설치가 실패할 수 있다. 위 git 설정에 더해, 관리자 PowerShell에서 OS 설정도 켜 두면 안전하다(재부팅 필요):
  ```powershell
  New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force
  ```
- 경로가 짧은 곳에 받는다(예: `C:\dev\`). OneDrive 동기화 폴더는 피한다.

```powershell
cd C:\dev
git clone https://github.com/BiohPark/mes-assistant-platform3.git
cd mes-assistant-platform3
```

## 3. 초기 설정

```powershell ci
pnpm install
pnpm setup:env
```

`pnpm setup:env`는 `.env.example`을 `.env`로 복사한다(이미 있으면 건드리지 않음). 직접 복사해도 된다: `Copy-Item .env.example .env`.
`.env`는 **커밋하지 않는다**. 예시 값은 로컬 개발용 가상 값이다.

| 항목 | 뜻 | 개발 기본값 |
|---|---|---|
| `MARIADB_DATABASE` · `MARIADB_USER` · `MARIADB_PASSWORD` · `MARIADB_ROOT_PASSWORD` | Docker MariaDB를 만들 때 쓰는 DB·사용자·비밀번호·root 비밀번호 | `mes_hub` · `mes` · 가상 값 |
| `MARIADB_PORT` | Docker MariaDB의 호스트 포트 | `3306` |
| `KEYCLOAK_PORT` · `KEYCLOAK_ADMIN_PASSWORD` · `DEV_USER_PASSWORD` | Keycloak(OIDC 모드 전용, `--profile oidc`) 포트·관리 콘솔 비밀번호·테스트 계정 비밀번호 | 가상 값 |
| `FAKE_OPENWEBUI_PORT` | 가짜 OpenWebUI 포트 | `3101` |
| `API_PORT` | api 포트 (web 개발 서버의 `/api` 프록시도 이 값을 따른다) | `3000` |
| `AUTH_MODE` | 로그인 방식: `local`(앱 자체 로그인, 기본) 또는 `oidc`(SSO) | `local` |
| `APP_ORIGIN` | 브라우저가 여는 앱 주소. OIDC 콜백은 `{APP_ORIGIN}/api/auth/callback`. `https://`면 Secure 쿠키 | `http://localhost:5173` |
| `DATABASE_URL` | api가 붙는 MariaDB | `mysql://mes:…@localhost:3306/mes_hub` |
| `SESSION_SECRET` | 쿠키 서명 비밀(32자 이상). 운영은 무작위 값 | 가상 값 |
| `OIDC_ISSUER` · `OIDC_CLIENT_ID` · `OIDC_CLIENT_SECRET` | SSO(OIDC) 발급자·앱 ID·비밀 — `AUTH_MODE=oidc`일 때만 필수 | 개발 Keycloak realm `mes-dev` |
| `INITIAL_SYSTEM_OWNERS` | 가입·로그인 때 System Owner로 만들 사용자 — `local`: 로그인 ID / `oidc`: `preferred_username` 또는 `sub`, 쉼표 구분 | `dev-owner` |
| `LLM_MODE` | `mock`(개발·E2E 기본, 가짜 응답) / `live`(실제 호출) | `mock` |
| `LLM_PRESET` | `openwebui`(서버가 `{origin}/api`를 붙임, 파일은 Files API) / `openai-compatible`(OpenAI 등 — base URL 그대로, 파일은 본문) | `openwebui` |
| `LLM_BASE_URL` · `LLM_API_KEY` | LLM 서비스 주소·키 — `live`일 때 필수. **키는 이 파일에만**, 화면·응답·로그에 나오지 않음 | 가짜 OpenWebUI |
| `LLM_DEFAULT_MODEL` | 전역 기본 모델 ID(선택) | 비움 |
| `FILE_STORAGE_ROOT` | 파일 저장 루트(상대 경로면 api 실행 폴더 기준). 드라이브·UNC 경로 가능 | `./storage` |
| `FILE_MAX_BYTES` · `FILE_MAX_PER_REQUEST` | 파일 하나 최대 크기(바이트)·요청당 첨부 개수 — PRD §6 제안값, 확정 시 기본값만 갱신 | `52428800`(50 MB) · `20` |
| `REQUEST_FIRST_TOKEN_MS` · `REQUEST_FILES_FIRST_TOKEN_MS` · `REQUEST_IDLE_MS` | AI 요청 시간 제한 — 첫 토큰(첨부 없음/있음)·토큰 사이 (FR-33) | `60000` · `360000` · `60000` |
| `REQUEST_LEASE_MS` · `REQUEST_KEEPALIVE_MS` · `REQUEST_SWEEP_MS` · `REQUEST_FLUSH_MS` | 생존 신호 유효 시간·갱신 주기·끊긴 요청 정리 주기·답변 DB 반영 주기 | `30000` · `10000` · `30000` · `250` |
| `REQUEST_BUDGET_BYTES` | 요청 본문 크기 한도(바이트, 첨부 파일 바이트 제외) — 초과 시 전송 차단. SO 전역 설정이 있으면 그 값 | `262144`(256 KiB) |

## 4. DB 셋업

둘 중 하나를 고른다.

### (a) Docker로 MariaDB 기동 — 개발 기본

Docker Desktop을 켠 뒤:

```powershell
docker compose up -d --wait
```

MariaDB 11.8·가짜 OpenWebUI가 함께 뜬다(`--wait`는 준비될 때까지 기다린다). DB·사용자는 `.env` 값으로 자동 생성된다. Keycloak은 OIDC 모드에서만 필요하다(5장).

### (b) Windows에 MariaDB 직접 설치

MSI 설치 프로그램은 기본값대로 두면 된다(Windows 서비스로 등록, 포트 3306). 설치 때 정한 `root` 비밀번호를 이 터미널에 넣어 둔다:

```powershell
$env:MYSQL_PWD = "<설치 때 정한 root 비밀번호>"
```

DB와 앱 사용자를 만든다. 비밀번호는 `.env`의 `DATABASE_URL`과 같아야 한다(개발 기본값 그대로 두면 아래 명령 그대로).

- DB는 반드시 `utf8mb4` · `utf8mb4_nopad_bin`으로 만든다(대소문자·끝 공백까지 구분). 다르면 `pnpm db:migrate`가 거부한다.
- 마지막 줄의 `t_*` 권한은 DB 통합 테스트가 임시 DB를 만들기 때문에 필요하다(운영 DB 사용자에는 주지 않는다).
- 운영에서는 `'mes'@'%'` 대신 api 서버 주소로 접속 호스트를 좁힌다.

```powershell ci
mariadb -u root -e "CREATE DATABASE mes_hub CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin;"
mariadb -u root -e "CREATE USER 'mes'@'localhost' IDENTIFIED BY 'dev-mariadb-password', 'mes'@'%' IDENTIFIED BY 'dev-mariadb-password';"
mariadb -u root -e "GRANT ALL PRIVILEGES ON mes_hub.* TO 'mes'@'localhost', 'mes'@'%';"
mariadb -u root -e 'GRANT ALL PRIVILEGES ON `t\_%`.* TO ''mes''@''localhost'', ''mes''@''%'';'
```

이 경로에서는 Docker가 전혀 필요 없다 — 로그인은 앱 자체 회원가입이다(5장).

### 마이그레이션

(a)·(b) 공통. 스키마(`apps/api/drizzle/`)를 DB에 적용한다:

```powershell ci
pnpm db:migrate
```

`마이그레이션 적용 완료`가 나오면 된다. 다시 실행해도 안전하다(적용된 것은 건너뜀).

### 개발용 시드

에이전트 카탈로그(가상 데이터 12개)와 분류 코드를 넣는다. 사용자는 **회원가입**으로 만든다.

```powershell ci
pnpm db:seed
```

다시 실행해도 안전하다(있는 항목은 건너뜀). `NODE_ENV=production`이면 거부한다 — 운영 DB에는 넣지 않는다. 시드 없이 시작하면 허브가 비어 있는 것이 정상이다.

## 5. 로그인

### 기본 — 앱 자체 로그인 (`AUTH_MODE=local`)

이번 페이즈는 사내 SSO를 연계하지 않는다(HANDOFF D32·D34). 앱이 ID·비밀번호를 직접 관리한다.

- 첫 화면에서 **회원가입** → ID(소문자·숫자·`.`·`_`·`-` 3~32자)와 비밀번호(8자 이상) → 가입 즉시 로그인된다.
- **첫 System Owner**: 아직 SO가 한 명도 없을 때 `.env`의 `INITIAL_SYSTEM_OWNERS`(기본 `dev-owner`)에 있는 ID로 가입하면 SO가 된다. SO가 생긴 뒤에는 이 목록이 적용되지 않으므로 **배포 직후 관리자가 먼저 가입**한다. 그 밖은 기본 사용자. SO·BO 지정 화면은 S4.
- 비밀번호는 Node 내장 scrypt로 해시해 저장한다. 별도 설정·서비스가 필요 없다.

### 선택 — SSO(OIDC) 모드 (`AUTH_MODE=oidc`)

후속 페이즈의 사내 SSO 연계용. 개발에서는 Keycloak을 사내 IdP 대역으로 쓴다. `.env`에 `AUTH_MODE=oidc`를 두고 Keycloak을 프로필로 띄운다:

```powershell
docker compose --profile oidc up -d --wait keycloak
```

- Keycloak: http://localhost:8180 (관리 콘솔 `admin` / `.env`의 `KEYCLOAK_ADMIN_PASSWORD`), realm `mes-dev`
- 테스트 계정 — 비밀번호는 모두 `.env`의 `DEV_USER_PASSWORD`

| 계정 | 역할 |
|---|---|
| `dev-owner` | System Owner (`INITIAL_SYSTEM_OWNERS`) |
| `dev-member` | 담당자 |
| `dev-requester` | 담당자 (요청자 역할 구분은 S4) |

이 계정들은 Keycloak(OIDC 모드)에만 있다. local 모드에서는 회원가입으로 만든다.

Docker를 쓸 수 없다면: Keycloak 배포판(zip, Java 21 필요)을 받아 `docker\keycloak\mes-dev-realm.json`을 `data\import\`에 복사하고, 그 파일의 `${OIDC_CLIENT_SECRET}` `${APP_ORIGIN}` `${DEV_USER_PASSWORD}`를 환경 변수로 준 뒤 `bin\kc.bat start-dev --http-port=8180 --import-realm`로 띄운다.

### 운영 — 사내 SSO로 바꿀 때 (후속 페이즈)

코드는 바꾸지 않는다. `.env`(운영은 서버 비밀 저장소)의 값만 바꾼다 — `AUTH_MODE=oidc`와 아래 값.

| 설정 | 넣을 값 (IT 부서에 요청 — [architecture.md §5](../next-project/architecture.md) 체크리스트) |
|---|---|
| `OIDC_ISSUER` | 사내 IdP의 issuer 주소 (`{issuer}/.well-known/openid-configuration`이 열려야 함) |
| `OIDC_CLIENT_ID` · `OIDC_CLIENT_SECRET` | 사내 IdP에 등록한 앱의 ID·비밀 |
| `APP_ORIGIN` | 운영 앱 주소(`https://…`). IdP에 콜백 `{APP_ORIGIN}/api/auth/callback` 등록 |
| `INITIAL_SYSTEM_OWNERS` | 최초 System Owner의 SSO 사용자 ID |
| `SESSION_SECRET` | 새 무작위 값(32자 이상) |

- 받는 사용자 정보: `sub`(고유 ID)·`name`·`preferred_username`. 사용자는 `(issuer, sub)`로 식별하므로 IdP를 바꾸면 기존 사용자와 이어지지 않는다.
- SAML만 지원하는 IdP는 아직 미구현이다(S1 이후 필요 시 추가).

## 6. 서버 기동

### 개발 모드 — 한 줄

```powershell
pnpm dev
```

api(워크스페이스 패키지 빌드 → 감시 모드)와 web(Vite)이 함께 뜬다. 멈출 때는 `Ctrl+C`.

| 주소 | 내용 |
|---|---|
| http://localhost:5173 | 앱 — 여기로 접속한다 (`/api`는 api로 프록시) |
| http://localhost:3000/api/health | api 상태 (`{"status":"ok","db":"up"}`) |
| http://localhost:8180 | Keycloak (OIDC 모드일 때만) |

**확인**: 브라우저에서 http://localhost:5173 → 회원가입(예: `dev-owner`) → "에이전트 허브"에 **"등록된 에이전트가 없습니다"** 가 보이면 성공. 오른쪽 위 이름 → 로그아웃 → 다시 로그인.

### 운영 모드 (S0 기준 — 배포 방식은 S5에서 확정)

```powershell ci
pnpm build
```

- api: `pnpm --filter @mes/api start` (루트 `.env`를 읽는다. 운영은 환경 변수로 주입)
- web: `apps\web\dist`의 **정적 파일**을 웹 서버가 제공하고, 같은 주소의 `/api/*`를 api로 넘겨야 한다(쿠키·OIDC 콜백이 한 주소여야 함). S0에서는 확인용으로 `pnpm --filter @mes/web preview`(http://localhost:5173, `/api` 프록시 포함)를 쓸 수 있다. 운영용 제공 방식(IIS 리버스 프록시 / api가 정적 파일까지 제공 등)은 S5에서 정한다.

## 7. 테스트 실행

```powershell ci
pnpm typecheck
pnpm lint
pnpm test
pnpm test:db
```

| 명령 | 내용 | 필요 |
|---|---|---|
| `pnpm typecheck` | 타입 검사 | — |
| `pnpm lint` | 린트(경고도 실패) | — |
| `pnpm test` | 단위 테스트 | — (DB 없이) |
| `pnpm test:db` | DB 통합 테스트(제약 동작·동시성 포함) | MariaDB + 임시 DB(`t_*`) 권한 |
| `pnpm test:e2e` | 브라우저 E2E(회원가입 → 로그인 → 빈 허브) | MariaDB, 처음 한 번 `pnpm --filter @mes/e2e install:browsers` |

`pnpm test:e2e`는 api·web을 알아서 띄운다(이미 떠 있으면 재사용). CI의 Windows 잡은 E2E를 아직 돌리지 않는다(S1 이후 추가).

## 8. 운영 배포 초안 — Windows 서비스 (S5에서 확정)

> **초안이다.** 방식은 S5에서 정한다. 컨테이너 배포도 후보로 남아 있다.

api를 Windows 서비스로 상시 실행하는 후보:

| 후보 | 방식 | 메모 |
|---|---|---|
| [WinSW](https://github.com/winsw/winsw) | XML 설정 + 실행 파일로 `node dist\main.js`를 서비스 등록 | 단일 exe, 로그 회전, 자동 재시작 |
| [NSSM](https://nssm.cc/) | `nssm install mes-hub-api node.exe …` | 간단하지만 유지보수가 멈춤 |
| [node-windows](https://github.com/coreybutler/node-windows) | Node 스크립트로 서비스 등록 | 추가 의존성 |

공통 준비: `pnpm build` → 서비스 작업 폴더 `apps\api` → 실행 `node dist\main.js` → 환경 변수는 서비스 설정으로(`.env` 대신) → 파일 저장 루트 `FILE_STORAGE_ROOT`(예: `D:\mes-hub\storage` 또는 `\\nas\mes-hub`)에 서비스 계정 쓰기 권한 → web 정적 파일은 IIS 등에서 제공하고 `/api`를 api로 프록시.

## 9. 문제 해결

| 증상 | 원인·해결 |
|---|---|
| `pnpm : 이 시스템에서 스크립트를 실행할 수 없으므로 …pnpm.ps1 파일을 로드할 수 없습니다` | PowerShell 실행 정책. `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` 후 터미널 재시작 |
| `corepack enable`이 `EPERM` | Node 설치 폴더 쓰기 권한. 관리자 PowerShell에서 한 번 실행하거나 `npm install -g pnpm@10` |
| `Unsupported engine` / Node 버전 경고 | Node 22가 아님. `node --version` 확인 → `nvm use 22` |
| `EADDRINUSE` / `Port 5173 is already in use` | 포트 충돌. 쓰는 프로세스 찾기: `Get-NetTCPConnection -LocalPort 5173 \| Select-Object OwningProcess` → `Stop-Process -Id <PID>`. 또는 `.env`에서 `API_PORT`·`KEYCLOAK_PORT`·`MARIADB_PORT` 변경(`APP_ORIGIN`·Keycloak 콜백은 5173 기준이라 web 포트를 바꾸면 `APP_ORIGIN`도 함께) |
| 3306 충돌 (직접 설치한 MariaDB·MySQL과 Docker MariaDB가 둘 다 뜸) | 한쪽만 쓴다. Docker 쪽을 쓰면 `.env`의 `MARIADB_PORT=3307`·`DATABASE_URL`의 포트도 3307로 |
| `pnpm db:migrate`가 `DB 문자셋/정렬은 utf8mb4/utf8mb4_nopad_bin이어야 합니다` | DB를 다른 정렬로 만들었다. 비어 있는 DB면 `ALTER DATABASE mes_hub CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin;` 후 다시 실행 |
| `git diff`에 모든 줄이 바뀐 것으로 보임 / `^M` | CRLF로 체크아웃됨. `git config --global core.autocrlf false` 후 `git rm --cached -r . ; git reset --hard` (작업 중인 변경은 먼저 커밋·보관) |
| `Filename too long` / `ENAMETOOLONG` | 긴 경로. 2장의 `core.longpaths`·`LongPathsEnabled`, 저장소를 `C:\dev\` 같은 짧은 경로로 |
| `pnpm install`이 매우 느림 | 백신 실시간 검사가 `node_modules`를 검사. 저장소 폴더와 pnpm 스토어(`pnpm store path`)를 Microsoft Defender 제외 목록에 추가(회사 정책 확인) |
| 로그인 뒤 "서버에 연결할 수 없습니다" | api가 안 떠 있거나 DB 연결 실패. http://localhost:3000/api/health 확인 → `db: down`이면 MariaDB·`DATABASE_URL` 확인 → "다시 시도" |
| 로그인 화면에서 "ID 또는 비밀번호가 올바르지 않습니다" | ID 오타 또는 다른 비밀번호. 계정이 없으면 회원가입. 초기화하려면 개발 DB를 비운다(`docker compose down -v` 또는 DB 재생성) |
| (OIDC) Keycloak 로그인 뒤 `Invalid parameter: redirect_uri` | `APP_ORIGIN`이 Keycloak에 등록된 콜백과 다름. `.env` 수정 후 `docker compose --profile oidc up -d --force-recreate keycloak` |
| `docker compose up`이 `.env에 … 필요` 로 멈춤 | `.env`가 없음 → `pnpm setup:env` |
| `pnpm db:migrate`가 `Access denied for user` | `DATABASE_URL`의 사용자·비밀번호가 4장에서 만든 값과 다름 |
