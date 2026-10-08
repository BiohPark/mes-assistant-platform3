# 실행 가이드 — Windows (기준)

이 저장소를 처음 받은 개발자·운영자가 **이 문서만 보고** 설치 → 로그인 → 빈 허브까지 가기 위한 안내다.
모든 명령은 **PowerShell** 기준이다(Windows Terminal 또는 VS Code 터미널). macOS 차이는 [macos.md](macos.md).

> 문서와 실제가 어긋나지 않도록, 이 문서에서 ` ```powershell ci ` 로 표시된 명령 블록은 CI의 Windows 잡(`setup-guide`)이 **그대로 실행**한다(`scripts/run-doc-commands.mjs`). GUI 설치·Docker·브라우저 로그인 단계는 사람이 확인한다.
> 명령이 바뀌면 이 문서를 **같은 커밋에서** 고친다.

현재 단계: **S5 진행 중** — 운영 배포 묶음과 Windows 서비스 절차를 확인한다.

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
| `WEB_DIST_DIR` | web 정적 파일 위치(선택). 비우면 api 기준 `../web/dist`를 찾고, 폴더가 없으면 제공하지 않는다 | 비움 |
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

역할별 테스트 계정(`dev-owner` System Owner · `dev-member` 담당자 · `dev-requester` 요청자, 비밀번호 `DEV_USER_PASSWORD`)이 필요하면 개발용 `.env`에서 `SEED_DEV_ACCOUNTS=true`로 바꾼 뒤 `pnpm db:seed`를 실행한다. 실제 사용자가 한 명이라도 있는 DB에서는 만들지 않는다. **운영 `.env`에서는 켜지 않는다.** 시드는 SR 접수 에이전트가 비어 있으면 URS 분석 도우미로 지정한다.

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

### 운영 모드 — 단일 주소

```powershell ci
pnpm release
```

`release\mes-hub`가 생성된다. api가 web 정적 파일을 함께 제공하므로 앱과 `/api/*`는 `APP_ORIGIN`의 같은 주소를 쓴다. 운영 설치는 8장의 `deploy:local`을 사용한다. 대상 PC에는 Node 22, pnpm 10, MariaDB가 필요하다. `WEB_DIST_DIR`을 비우면 묶음의 `web\dist`를 자동으로 찾는다. 개발 모드는 계속 Vite(`pnpm dev`)를 쓴다.

CI는 생성된 묶음을 직접 기동해 정적 페이지와 API를 확인한다. 서비스 설치는 운영 서버에서 8장대로 한다.

```powershell ci
node scripts/verify-release.mjs
```

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

## 8. 운영 배포 — Windows 서비스

운영 HOME(예: `D:\mes-hub`)에는 `app`(교체 대상), `config\.env`, `service`(WinSW exe/XML), `storage`, `logs`, `backups`, `deployment-state.json`(배포 상태)을 둔다. 설정·파일·서비스·로그는 `app` 밖에 유지한다. HOME은 반드시 저장소 밖의 절대 경로여야 한다. 저장소 자체와 그 하위(`release\mes-hub` 포함)는 release 빌드 전에 거부한다. 서버에 Node 22, pnpm 10, MariaDB를 설치하고 4장의 DB 문자셋·정렬 및 앱 DB 사용자를 준비한다. 서버의 저장소에서 `git pull` 후 다음 순서로 설치한다.

1. `pnpm deploy:local -- --home D:\mes-hub --init`을 실행한다. 이 명령은 폴더·`config\.env`·`service\mes-hub.xml`을 새로 만든다. 기존 설정이나 앱을 덮어쓰지 않는다.
2. `D:\mes-hub\config\.env`에서 `DATABASE_URL`, `SESSION_SECRET`, `APP_ORIGIN`(예: `http://서버주소:3000`), `INITIAL_SYSTEM_OWNERS` 등 운영 값을 설정한다. 초기 생성 시 `SEED_DEV_ACCOUNTS=false`, `FILE_STORAGE_ROOT=D:\mes-hub\storage`, `NODE_ENV=production`으로 설정된다. 서비스 계정이 `config\.env`를 읽고 `storage`·`logs`에 쓸 수 있게 ACL을 설정한다. 비밀값을 XML에 넣지 않는다.
3. `pnpm deploy:local -- --home D:\mes-hub`로 첫 앱을 배포하고 DB를 마이그레이션한다. 아직 서비스 exe가 없으면 시작과 상태 확인을 생략한다. [WinSW v2.12.0 공식 릴리스](https://github.com/winsw/winsw/releases/tag/v2.12.0)의 Windows x64 실행 파일을 `D:\mes-hub\service\mes-hub.exe`로 둔 뒤, 관리자 PowerShell에서 `D:\mes-hub\service\mes-hub.exe install`과 `D:\mes-hub\service\mes-hub.exe start`를 실행한다. 서비스 계정의 PATH에서 `node.exe`를 찾을 수 있어야 한다. 첫 배포라면 `INITIAL_SYSTEM_OWNERS`의 ID로 가장 먼저 가입한다.
4. 브라우저에서 `APP_ORIGIN`을 열고 `/api/health`의 상태·버전·커밋을 확인한다. SO로 로그인하여 **진단** 메뉴(`/admin/diagnostics`)를 열고 **다시 확인**을 누른다. 문제가 있으면 **텍스트로 복사**하여 대화에 붙여 넣는다. 복사 텍스트에는 비밀값 대신 설정 여부만 나온다.

### 데모 bundle 이관

서비스를 멈추고 DB와 `FILE_STORAGE_ROOT`를 백업한 뒤, `D:\mes-hub\app`에서 `node --env-file=D:\mes-hub\config\.env api\dist\db\import.js C:\path\bundle.json --dry-run --default-owner <loginId>`로 테이블별 건수를 확인한다. 소유자가 빈 행이 있으면 `--default-owner`에 기존 또는 함께 가져올 사용자의 로그인 ID를 지정한다. 이어서 `--dry-run` 없이 실행한다. bundle 크기 제한은 기본 64 MiB이며 `IMPORT_BUNDLE_MAX_BYTES`로 조정한다. macOS/Node 22에서 60 MiB bundle의 최대 RSS는 382 MiB였다. Windows에서는 별도 측정 전까지 이관 프로세스에 최소 512 MiB의 여유 메모리를 둔다. 다중 SR 업무는 기본적으로 목록을 보여 주고 중단한다. 가장 이른 SR만 연결하고 나머지 연결의 권한·조회 손실을 수용할 때만 `--allow-multi-sr`를 지정한다. 새 계정의 로그인 ID와 임시 비밀번호는 실행 종료 시 표준 출력에 한 번만 표시되므로 각 사용자에게 안전한 경로로 전달한다. 같은 ID의 에이전트·코드는 서버 값을 유지하고 차이를 보고한다. 기존 콘텐츠와 그 하위 행의 내용·관계가 다르거나 누락되면 전체 이관을 중단한다.

### 분류 경로 업그레이드 (S7)

반드시 **서비스 중지 → DB와 파일 저장소 백업 → `pnpm db:migrate` → 검증 → 기동** 순서로 진행한다. 배포 묶음에서는 같은 환경 파일을 사용해 `api/dist/db/migrate.js`를 실행한다. 실행 중인 서버와 구버전 앱의 쓰기를 함께 중지한다.

마이그레이션은 경로 테이블을 생성한 뒤 기존 에이전트의 Lv1·Lv2 코드 쌍을 `sort_order = 0` 경로로 백필한다. 비활성 코드 참조와 기존 링크 재정의 값은 보존한다. CLI 보고의 에이전트 수·경로 수·`link1 재정의 보유` 수를 백업의 수와 대조한다. 검증은 모든 에이전트에 대표 경로가 존재하고 대표 컬럼이 일치하는지 확인하며, 서버도 기동 전에 같은 불변식을 검사해 위반하면 중단한다. 수동 검증에서는 아래 결과가 0건이어야 한다.

```sql
SELECT a.id
FROM assistant a
LEFT JOIN assistant_classification p ON p.assistant_id = a.id AND p.sort_order = 0
WHERE p.assistant_id IS NULL
   OR a.level1_code_id <> p.level1_code_id
   OR a.level2_code_id <> p.level2_code_id;
```

검증 뒤 서비스를 기동하고 `/api/health`와 카탈로그 경로를 확인한다. 다중 경로를 저장한 뒤 구버전으로 되돌릴 때는 **업그레이드 전 DB·파일 백업 복원**만 사용한다. 구형 대표 컬럼만으로 나머지 경로를 복구할 수 없으며 역마이그레이션은 제공하지 않는다. 앱 파일만 롤백한 상태에서는 서비스를 기동하지 않는다.

업데이트 전 외부 쓰기를 멈추고 **DB와 storage를 백업**한다. 저장소에서 `git pull` 후 `pnpm deploy:local -- --home D:\mes-hub --dry-run`으로 작업을 확인하고, `pnpm deploy:local -- --home D:\mes-hub`을 실행한다. 도구는 배포 시작 기록 → release 빌드 → 새 묶음을 임시 폴더에 복사·검증 → 서비스 중지 → 기존 `app` 백업·교체 → `config\.env`로 마이그레이션 → 서비스 시작 → `/api/health` 확인 → 성공 기록 순서로 진행한다. 성공한 기존 앱은 `backups\app-<시각>`에 저장한다. 실패하면 `deployment-state.json`에 실패를 기록하며, 교체 전 복사·검증 실패 시 기존 `app`의 성공 상태와 롤백 백업은 그대로 유지한다. 교체 후 마이그레이션·서비스 시작·상태 확인이 실패하거나 중단된 앱은 다음 배포에서 `backups\failed-<시각>`에 보관하고 정상 롤백 후보에서 제외한다. 서비스가 없으면 중지·시작·상태 확인을 생략하며, 서비스 제어를 건너뛸 때는 `--no-service`를 붙인다. 이 경우 마이그레이션 완료까지를 배포 성공으로 기록한다.

문제가 생기면 `pnpm deploy:local -- --home D:\mes-hub --rollback`으로 서비스를 중지하고 상태 기록의 `rollbackBackup`이 가리키는 성공한 이전 앱을 복원한다. 정상 V1에서 V2 마이그레이션이 실패한 뒤 V2 배포를 재시도해 성공해도, 롤백 대상은 실패했던 V2가 아닌 V1이다. 복원한 백업은 `app`으로 이동하고 롤백 대상 기록은 비운다. **DB는 자동 복원되지 않고 서비스도 시작하지 않는다.** 필요한 경우 되돌릴 앱에 맞는 DB 백업을 복원한 뒤 `pnpm deploy:local -- --home D:\mes-hub --start`로 서비스를 시작하고 상태를 확인한다. 설정·파일 저장소·로그는 롤백 중에도 유지된다.

`deployment-state.json`이 없는 기존 HOME에서는 과거 앱·백업의 성공 여부를 확인할 수 없으므로 자동 롤백 대상으로 선택하지 않는다. 첫 업데이트 때 기존 앱은 `failed-<시각>`에 보관한다. 기존 설치에서 이 도구로 전환할 때는 앱도 별도로 백업하고, 상태 기록을 삭제하거나 수정하지 않는다.

IIS를 TLS 앞단으로 둘 때만 ARR 리버스 프록시가 전체 요청을 이 서비스로 넘기게 한다. `/api/events`의 SSE 응답 버퍼링을 끄고 프록시 유휴 시간을 스트림 유지 시간보다 길게 설정한다. 이벤트 브로드캐스트는 **단일 api 인스턴스** 전제다. IIS 없이도 api 포트로 직접 접속할 수 있다.

### 운영 값과 기록 보관 (S5 ②, D43)

비기능 기본값은 PRD §6 제안값이며 모두 `.env`로 조정한다: 파일당 `FILE_MAX_BYTES`(50 MB)·요청당 첨부 `FILE_MAX_PER_REQUEST`(20)·동시 응답 `REQUEST_MAX_ACTIVE`(20, 넘으면 "잠시 후 다시" 429)·세션 `SESSION_TTL_HOURS`·`SESSION_IDLE_HOURS`(12)·로그인/가입 시도 제한 `AUTH_ATTEMPT_MAX`/`AUTH_ATTEMPT_WINDOW_MS`(실패 10회/10분, 인스턴스 메모리). IIS를 앞단에 두면 모든 요청이 프록시 주소로 보이므로 `TRUST_PROXY`에 **IIS 주소**(같은 서버면 `127.0.0.1`)를 지정해 사용자 IP를 쓰게 하고, IIS가 클라이언트가 보낸 `X-Forwarded-For`를 덮어쓰게 설정한다. 이때 API 포트(`API_PORT`)는 Windows 방화벽으로 외부 접근을 막는다 — 직접 접속이 열려 있으면 위조한 헤더로 시도 제한을 우회할 수 있다. 홉 수(`1`) 지정은 직접 접속이 막힌 경우에만 쓴다. `true`(모두 신뢰)는 거부되며 직접 노출 시에는 `false` 유지.

활동 이력·요청 기록은 추가만 된다(앱에 수정·삭제 경로 없음). 요청 원본 JSON은 GMP 보존 기준이 확정되기 전까지 **자동 삭제하지 않는다**(D43 S5-4). 기준이 정해지면 서비스를 멈추고 DB를 백업한 뒤 수동으로 정리한다 — 대상은 종료 후 1년이 지난 요청의 `chat_request.snapshot` 값과, 그 JSON이 가리키는 `FILE_STORAGE_ROOT\requests\YYYY\MM\*.json` 파일이다. 먼저 대상을 확인한다:

```sql
SELECT id, finished_at, status FROM chat_request
WHERE status IN ('succeeded','failed','cancelled','interrupted')
  AND snapshot IS NOT NULL
  AND finished_at < UTC_TIMESTAMP(6) - INTERVAL 1 YEAR;
```

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
