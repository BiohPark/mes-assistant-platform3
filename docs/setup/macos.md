# 실행 가이드 — macOS (Windows와 다른 점만)

기준 문서는 [windows.md](windows.md)다. 순서(1 준비물 → 2 받기 → 3 설정 → 4 DB → 5 로그인 → 6 기동 → 7 테스트)와 `pnpm …` 명령은 **그대로** 쓰고, 아래 차이만 바꿔 읽는다. 셸은 zsh(기본 터미널) 기준이다.

## 1. 사전 준비물

| 준비물 | 설치 |
|---|---|
| Git | Xcode 명령행 도구(`xcode-select --install`) 또는 `brew install git` |
| Node.js 22 | 버전 관리자 하나: [mise](https://mise.jdx.dev/) `mise use node@22`(저장소의 `mise.toml`을 읽음) · nvm `nvm install 22 && nvm use 22`(`.nvmrc`) · 또는 `brew install node@22` |
| pnpm 10 | `corepack enable` (Windows와 같음) 또는 `npm install -g pnpm@10` |
| MariaDB 11.8 (직접 설치 경로) | `brew install mariadb@11.8` → `brew services start mariadb@11.8`. 설치한 macOS 사용자가 비밀번호 없이 관리자로 접속한다 |
| Docker | Docker Desktop 또는 [OrbStack](https://orbstack.dev/) (`brew install --cask orbstack`). compose 파일은 표준 기능만 써서 둘 다 된다 |

설치 확인은 Windows와 같다(`git --version`, `node --version`, `pnpm --version`, `docker compose version`).
mise를 쓰는데 `node --version`이 22가 아니면 저장소 폴더 안에서 실행 중인지 확인하거나 `mise exec -- pnpm …`으로 실행한다.

## 2. 저장소 받기

- `core.autocrlf`는 macOS 기본값(설정 없음)이면 된다. 설정돼 있다면 `git config --global core.autocrlf input` 또는 `false`.
- 긴 경로 설정은 필요 없다.
- macOS 파일 시스템은 기본적으로 **대소문자를 구분하지 않는다** — import 경로의 대소문자가 틀려도 여기서는 동작하고 CI(Linux)에서 깨진다. 파일명 대소문자는 [git-policy.md](../git-policy.md) §4를 따른다.

## 3. 초기 설정

`Copy-Item .env.example .env` 대신 `cp .env.example .env` (또는 그대로 `pnpm setup:env`).

응답 대기 기본값은 첨부 없는 첫 응답 5분(`REQUEST_FIRST_TOKEN_MS=300000`), 첨부 첫 응답 10분(`REQUEST_FILES_FIRST_TOKEN_MS=600000`), 본문/생각 청크 사이 무응답 5분(`REQUEST_IDLE_MS=300000`), 최대 처리 시간 30분(`REQUEST_MAX_MS=1800000`, 세션 모드에서 OpenWebUI가 작업 중이면 무응답 제한을 연장하는 상한)이다. 기존 `.env` 값을 우선하므로 필요하면 직접 갱신한 뒤 API를 재시작한다. 업그레이드 시 `pnpm db:migrate`로 `message.reasoning` nullable text 컬럼을 추가한다(MariaDB 10.4 호환). 화면의 생각 과정은 접혀 보존되며 다음 요청·추정·요약에서 제외한다.

## 4. DB 셋업 — (b) 직접 설치

Homebrew MariaDB는 macOS 사용자가 관리자라 `-u root`와 비밀번호가 필요 없다(이 경로는 CI가 검증하지 않는다):

```bash
mariadb -e "CREATE DATABASE mes_hub CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin;"
mariadb -e "CREATE USER 'mes'@'localhost' IDENTIFIED BY 'dev-mariadb-password', 'mes'@'%' IDENTIFIED BY 'dev-mariadb-password';"
mariadb -e "GRANT ALL PRIVILEGES ON mes_hub.* TO 'mes'@'localhost', 'mes'@'%';"
mariadb -e "GRANT ALL PRIVILEGES ON \`t\\_%\`.* TO 'mes'@'localhost', 'mes'@'%';"
```

`mariadb`를 못 찾으면 `export PATH="$(brew --prefix mariadb@11.8)/bin:$PATH"` (`~/.zshrc`에 추가).

## 5–7. 로그인·기동·테스트

Windows와 같다. `pnpm dev` → http://localhost:5173 → 회원가입(예: `dev-owner`) → 빈 허브.

## 8. 운영 배포

운영 대상은 Windows다([windows.md §8](windows.md)). macOS는 개발용으로만 쓴다.
배포 묶음 생성은 저장소 루트에서 `pnpm release`로 하고, 로컬 운영 HOME 테스트는 `pnpm deploy:local -- --home /absolute/path/mes-hub --init --no-service`로 한다.
데모 bundle은 `mise exec -- pnpm db:import /path/to/bundle.json --dry-run --default-owner <loginId>`로 먼저 확인한다. 소유자가 빈 행이 있으면 `--default-owner`에 기존 또는 함께 가져올 사용자의 로그인 ID를 지정한다. 기본 크기 제한은 64 MiB다. macOS/Node 22에서 60 MiB bundle의 최대 RSS는 382 MiB였으므로 이관 프로세스에 최소 512 MiB의 여유 메모리를 둔다. 다중 SR 업무는 기본적으로 중단하며, 연결 손실을 수용할 때만 `--allow-multi-sr`를 추가한다.

### 직접 HTTPS 확인

방식 비교와 설정 규칙은 [Windows 직접 HTTPS 안내](windows.md#직접-https-또는-iis-tls-종료)를 따른다. `.pfx`는 `HTTPS_PFX_FILE`과 선택 `HTTPS_PFX_PASSPHRASE`, PEM은 `HTTPS_CERT_FILE`·`HTTPS_KEY_FILE`과 선택 `HTTPS_CA_FILE`이다. 두 방식을 섞지 않는다. 모두 비우면 기존 HTTP를 유지한다. PEM 인증서는 full chain, 키는 암호화되지 않은 PEM을 사용한다.

macOS에서는 경로만 바꾼다. 예를 들어 `.env`에 `HTTPS_CERT_FILE=/absolute/path/mes-hub/config/certificates/server-chain.pem`, `HTTPS_KEY_FILE=/absolute/path/mes-hub/config/certificates/server-key.pem`, `API_PORT=8443`, `APP_ORIGIN=https://localhost:8443`, `TRUST_PROXY=false`를 지정한다. PFX를 쓰면 PEM 설정 대신 `HTTPS_PFX_FILE=/absolute/path/mes-hub/config/certificates/server.pfx`를 지정한다. 호스트는 인증서 SAN과 일치해야 하며 Secure 쿠키는 `APP_ORIGIN`의 HTTPS 여부를 따른다. 직접 HTTPS인데 HTTP origin이면 경고한다. IIS 등 프록시에서 TLS를 종료하면 API `HTTPS_*`는 비우고 사용자 HTTPS origin과 신뢰할 프록시 IP/서브넷을 지정한다. API 직접 접근은 막는다.

배포 API가 빌드한 web을 제공하는 방식으로 확인한다. 기본 `pnpm dev`의 Vite 프록시는 HTTP API를 전제로 한다. 상대 인증서 경로는 읽은 `.env` 폴더 기준(.env 없으면 저장소 루트)이지만 절대 경로를 권장한다. API를 실행하는 계정에 상위 폴더 접근과 파일 읽기를 허용하고 개인 키/PFX와 `.env`의 권한을 해당 계정만 읽을 수 있게 제한한다(예: 소유자 지정 후 `chmod 600`). 인증서 교체 후 API를 재시작한다. Windows로 옮길 때는 WinSW 서비스 계정의 NTFS/공유 권한을 별도로 설정하고, `.env`의 Windows 경로는 큰따옴표 대신 작은따옴표나 `/` 구분자로 쓴다(큰따옴표 안의 `\n`은 줄바꿈이 된다).

사내 CA는 PEM 방식의 `HTTPS_CA_FILE`(발급 루트 포함)을 쓰거나, PFX·프록시 방식에서는 Node 시작 전에 셸에서 지정한다:

```bash
export NODE_EXTRA_CA_CERTS=/absolute/path/mes-hub/config/certificates/ca-chain.pem
```

macOS 키체인의 회사 CA 신뢰와 Node 신뢰는 별개다. `deploy-local.mjs`·`verify-release.mjs` 모두 CA와 호스트 이름을 검증하며 TLS 검증을 끄지 않는다. release 검증은 환경의 `HTTPS_*`로 HTTPS를 선택하며 인증서 SAN에 임시 서버 호스트 `127.0.0.1`이 필요하다. 단위 테스트 인증서·키는 OpenSSL로 실행 중 임시 폴더에 생성하고 종료 시 삭제한다. `openssl version`으로 실행 가능 여부를 확인한다.

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

### 기본 모델 전역 설정 (S9)

시스템 관리자(SO)는 전역 설정 화면에서 모델 목록을 선택하고 저장해 기본 모델을 바꿀 수 있다. 재기동 없이 다음 요청부터 요청 시작·SR 보조·요약·시스템 assistant·진단·시험 대화·체크리스트 점검에 적용된다. 대화나 에이전트에 직접 지정한 모델이 있으면 그 값을 우선한다.

기본 모델의 우선순위는 DB `app_setting.defaultModelOverride` → 서버 환경 파일의 `LLM_DEFAULT_MODEL` → 도메인 기본값이다. 화면의 **설정 해제(.env 값 사용)**를 누른 뒤 저장하면 전역 설정을 해제하고 `.env` 폴백을 사용한다. `.env`가 비어 있으면 도메인 기본값을 사용한다. 화면에서 현재 적용 모델과 출처를 확인할 수 있다. `.env` 자체를 수정할 때는 서비스를 재시작한다.

구형 `app_setting.defaultModel` 행은 계속 무시하고 삭제하지 않는다. 남아 있으면 서버 기동 로그에 경고 한 줄을 남긴다. 옛 값을 다시 쓰려면 전역 설정 화면에서 해당 모델을 선택해 저장한다.

## 9. 문제 해결 (macOS 차이)

| 증상 | 해결 |
|---|---|
| 포트 충돌 | `lsof -i :5173` → `kill <PID>` |
| 3306 충돌(Homebrew MariaDB·MySQL과 Docker MariaDB) | 한쪽만 쓴다 — `brew services stop mariadb@11.8` 또는 `.env`의 `MARIADB_PORT=3307`·`DATABASE_URL` 포트 변경 |
| `docker: command not found` | Docker Desktop/OrbStack 앱을 한 번 실행해 CLI를 설치 |
| Playwright 브라우저 없음 | `pnpm --filter @mes/e2e install:browsers` |

선택 설정 `DEFAULT_EMAIL_DOMAIN=example.com`은 이메일 미설정 계정의 응답에 `{loginId}@{도메인}`을 기본값으로 표시하며 DB에 저장·백필하지 않는다. 설정을 비우면 기본 이메일은 `null`이다.
도메인은 전체 253자 이하이며 각 구간은 1–63자의 영숫자·하이픈만 허용하고 앞뒤 하이픈은 금지한다. 최상위 도메인은 영문 2자 이상이어야 한다. 잘못된 값이면 기동 시 `DEFAULT_EMAIL_DOMAIN` 설정 오류를 낸다.


### OpenWebUI 도구 전달 (S10)

SO는 전역 설정의 **OpenWebUI 도구 전달**에서 자동(기본) / 끔을 고르면 바로 저장된다. DB 키는 `app_setting.owuiTools`이며 없으면 자동이다. 재시작 없이 다음 요청부터 적용된다.

**OpenWebUI 요청 방식(S12)**: `LLM_OWUI_MODE`=`auto`(기본)·`session`·`direct`. 세션 방식은 OpenWebUI 화면처럼 채팅을 만들어 보내므로 URL 읽기 같은 기본 도구가 켜지고, 서버가 그 채팅을 폴링해 답·생각 과정·진행 상태를 받는다. 서비스 키가 `/api/v1/chats`·`/api/tasks`를 쓸 수 있어야 한다. `auto`는 시작 단계에서 거부(4xx)되거나 응답 형식이 다르면 기존 방식으로 보낸다. `LLM_OWUI_CLEANUP=true`(기본)이면 완료 뒤 OpenWebUI 쪽 채팅을 지운다(서비스 계정에 채팅 삭제 권한 필요). 관리 설정(`owuiMode`·`owuiCleanup`)이 있으면 그 값이 우선한다.

`LLM_MODE=live`, `LLM_PRESET=openwebui`인 자동 모드는 `/api/models`의 선택 모델 `info.meta.toolIds`·`defaultFeatureIds`를 읽어 5분 동안 캐시한다. 진단과 같은 식별자 허용 목록만 사용하며, 도구·기능이 하나라도 있으면 `tool_ids`, `features: {기능ID: true}`, `params.function_calling: legacy`를 추가한다. 메타가 없거나 조회하지 못하면 기본 방식으로 보낸다. 앱 자체 함수 도구가 있는 호출은 기존 방식으로 보낸다.

도구 전달 호출은 서버가 요청을 실행하지 않았음이 확실한 경우에만 동일 메시지·파일을 기본 방식으로 한 번 다시 보낸다. 대상은 HTTP 400·404·405·415·422의 요청 형식 거부 또는 요청 본문 전송 전의 연결 수립 실패(ECONNREFUSED·ENOTFOUND·EAI_AGAIN·ENETUNREACH·EHOSTUNREACH)다. 그 밖의 HTTP 오류(5xx 포함), 시간 초과, 첫 SSE 프레임 전 연결 끊김·원인 불명의 네트워크 오류는 실패로 처리해 사용자 재시도에 맡긴다. sources·reasoning 등 응답 프레임을 이미 받았거나 취소·크기 제한으로 중단한 경우도 자동 재전송하지 않는다. 기존 재시도 경로의 멱등 키 처리도 유지한다. 요청 기록과 **사용한 자료**에는 도구 전달 / 기본 방식 / 폴백과 실제 마지막 시도의 `tool_ids`·`features`가 보인다. 원본 JSON도 그 시도의 값을 담고, 폴백하면 도구 필드는 사라진다. 트레이 바이트는 기존 메시지·파일 입력 예산이며 도구 메타를 더하지 않는다. `transport`는 계속 파일 전달 방식을 뜻한다. `chat_request.owui_tools` nullable JSON 컬럼을 추가하는 마이그레이션을 적용한다.

가짜 OpenWebUI의 `FAKE_OWUI_REJECT_TOOL_IDS=1`은 `tool_ids`가 있는 호출을 400으로 거부한다. live E2E의 `owui-tools.spec.ts`는 `FAKE_OWUI_E2E=1`에서만 열리는 `/__e2e/tool-ids` 제어로 거부 모드를 바꾸고 복원하며 성공·폴백·끔과 단일 요청 기록을 확인한다. session_id·chat_id를 만들지 않으며, 이 방식은 OpenWebUI 화면의 세션 기반 builtin 도구 전체를 구현하지 않는다.
