# HANDOFF — MES Agent Hub (실제 제품 저장소)

다른 세션(사람 또는 AI)이 이어서 작업할 수 있도록 원칙·현재 상태·결정·남은 일·주의점을 한곳에 둔다.
기준 시점: 2026-09-28, `feat/s0-skeleton` (S0 뼈대 완료, push·`main` 병합 전).
데모의 HANDOFF(화면·데이터 흐름·데모 함정 상세)는 데모 저장소 `mes-assistant-platform2`의 태그 `demo-final`에 있다.

---

## 1. 한 줄 요약

사내 AI 에이전트(OpenWebUI assistant)를 카드로 골라 대화하고, 대화끼리 태그로 느슨하게 이어 파일과 대화를 주고받는 업무 플랫폼의 **실제 제품**. 데모에서 검증한 동작을 서버(NestJS)·DB(MariaDB, D40)·파일 저장·사내 SSO 기반으로 옮긴다.

## 2. 원칙 (반드시 지킬 것)

| 원칙 | 의미 | 새 저장소 위치 |
|---|---|---|
| **플랫폼 ≠ 워크플로우** | 질문 흐름·작성 절차·역할 프롬프트는 assistant(OpenWebUI) 안에 있다. system 메시지는 플랫폼 컨텍스트(대화·태그·연결 SR·고른 입력)만 | `packages/llm/src/context.ts` |
| **대화 1개 = 업무 1개** | 대화 = task, 스레드 1개 고정. 첫 전송·첨부 때 생성(지연 생성) | DDL `task`·`thread` |
| **태그로 느슨한 결합** | 같은 태그를 **직접** 공유하는 대화의 파일·대화가 후보, **사람이 ☑/★로 고른 것만** AI로. 버전·스냅샷 고정, 자동 교체·간접 확산 없음 | `packages/domain/src/tags.ts` |
| **보낸 것 = 본 것** | 트레이 추정과 실제 전송은 같은 조립 함수. 자동 절단·자동 요약 금지, 한도 초과면 전송을 막는다 | `packages/llm/src/promptBuilder.ts`, `packages/domain/src/requestBudget.ts` |
| **요청은 서버 RequestService만** | 대화당 진행 중 1건(DB 부분 고유 인덱스 `chat_request_one_active`), 생존 신호 `lease_until`, 정리·재시도 | S3 |
| **OpenWebUI는 서버 대리 호출** | API + 링크만. 키는 서버 비밀 저장소에만 | S1 |
| **파일은 파일 그대로** | 디스크·NAS에 보관, DB에는 메타데이터와 `storage_key`만 | S2 (`FileStorageService`) |
| **역할은 앱이 관리, 서버가 강제** | 로그인은 SSO, 역할(담당자·SO·요청자)은 앱. 에이전트 관리·전역 설정은 SO만(D19) | `apps/api/src/auth/guards.ts` (`@Roles`) |
| **크로스플랫폼(최종 Windows)** | Docker는 개발 의존 서비스만, 스크립트에 셸 문법 금지, 경로는 `path`만, LF | [CLAUDE.md](../CLAUDE.md) "크로스플랫폼 원칙" |
| **공개 저장소** | 사내 주소·실명·양식 번호·참고 이미지·비밀값 금지 | 7장 |

## 3. 스택 · 실행

- pnpm 10 모노레포 · Node 22 · TypeScript 6 · 테스트 vitest 5 + Playwright · 린트 oxlint(경고도 실패)
- web: React 19 · Vite 8 · Tailwind v4 · shadcn/ui · react-router 8 · TanStack Query
- api: NestJS 12(ESM) · Drizzle(mysql2) · openid-client 6 · zod 4
- 개발 의존 서비스: `docker-compose.yml` — MariaDB 11.8(정렬 `utf8mb4_nopad_bin`), Keycloak 26(realm `mes-dev`, 가상 사용자 3명), 가짜 OpenWebUI(`docker/fake-openwebui/server.mjs`)
- 실행·명령: 설치 가이드 [setup/windows.md](setup/windows.md)(기준)·[setup/macos.md](setup/macos.md), 요약은 [README](../README.md). git 규칙 [git-policy.md](git-policy.md)

## 4. 구조

```
apps/api/src
  config/      loadConfig(env) — zod 검증, 비밀값은 여기서만 읽음
  db/          schema.ts(Drizzle, DDL 정본) · connection.ts(세션 고정) · errors.ts · migrate.ts · db.module.ts · schema-drift.test.ts · schema-constraints.db.test.ts(제약 동작)
  auth/        oidc.service(OIDC RP, PKCE·state·nonce) · session.service(app_session, 토큰 해시) · users.service(첫 로그인 생성·최초 SO)
               guards(SessionGuard 기본 로그인 필수·@Public 예외 → RolesGuard @Roles) · auth.controller(login·callback·logout·me)
  health/      GET /api/health (DB 상태)
apps/web/src
  app/         AuthGate(/api/me, 401→SSO) · AppShell(데모 셸) · TopBar(사용자·로그아웃) · LoggedOutPage · router
  features/home/HomePage   S0 빈 허브
packages/domain  데모 src/domain 전부 (+ lib/dates)
packages/llm     데모 src/llm (useModelList 제외). ports.ts의 LlmPorts로 저장소·파일 바이트 주입
packages/contracts  Me·Role·Health (zod)
```

- 워크스페이스 패키지 해석: `exports`의 `"source"` 조건 → 개발·테스트·타입 검사는 빌드 없이 `src`, 런타임(node)은 `dist`. vitest 공통 설정 `vitest.shared.ts`.
- 인증 흐름: web `/` → `GET /api/me` 401 → `/api/auth/login`(검증값은 서명된 httpOnly 쿠키 `mes_oidc`) → Keycloak → `/api/auth/callback`(Vite가 `/api`를 같은 출처로 프록시) → `app_user` 반영 → `mes_session` 쿠키 → 허브.

## 5. 결정 사항 로그

D1–D21은 데모에서 내려진 결정으로, 이 저장소에서도 유효하다(상세 근거는 데모 HANDOFF).

| # | 결정 | 근거/출처 |
|---|---|---|
| D1 | 패키지(발행/받기/발췌) 제거 → 태그로 일원화 | 사용자 |
| D2 | 대화 1개 = 스레드 1개 | 사용자 |
| D3 | 칸반 열 = 에이전트(공통 순서), 단계는 Lv1/Lv2 다중 필터 | 사용자·Codex |
| D4 | 순서는 공통 설정, SO가 편집 모드에서 변경 | 사용자·Codex |
| D5 | SR 태그만 저채도 결정색, 일반 태그 중립색, SR 태그 개수 제한 없음 | 사용자 |
| D6 | 공유 자료함은 직접 태그 공유만, 사람이 고른 입력만 AI 전달, 새 버전 자동 교체 없음 | Codex 안 |
| D7 | 접수 에이전트·명시적 "접수로 전환"·AI 제목 별도 요청·수동 제목 보호 | Codex 안 |
| D8 | 모델 ID 기본 비움(공통 기본 모델), 관리 페이지에서 매핑 | 사용자 |
| D9 | 워크플로우는 assistant 쪽 — 역할 지침 주입 없음 | 사용자 |
| D10 | 입력 파일은 OpenWebUI Files API 첨부 (D17로 실패 처리 변경) | 사용자 |
| D11 | 체크리스트: 기본값 + 관리 수정, 강제 없음, AI 달성도 m/n | 사용자 |
| D12 | OpenWebUI와 UI 연동 없음, API 호출 + 대화창 링크만 | 사용자 |
| D13 | 시드는 가상 카탈로그, 사내 주소·이미지 문구 금지 | 사용자 |
| D14 | System Owner는 여러 명. 이 저장소에는 명단(실명)을 기록하지 않고 배포 설정 `INITIAL_SYSTEM_OWNERS`·관리 화면으로 지정 | 사용자 · 이 저장소 규칙 |
| D15 | 대화 간 컨텍스트: 같은 태그 대화를 통째로 선택 + 메시지 선택·요약으로 조절. 순서 기반 인계·자동 절단·자동 요약·재귀 수집 금지 | 사용자 |
| D16 | 데모는 데모로 마무리, 실제 구현은 이 저장소 | 사용자 |
| D17 | 파일 전달 실패 시 요청 중단 + 항목별 선택 | 사용자 |
| D18 | 미확정 정책 12개 추천값 확정 (PRD §5) | 사용자 (2026-09-27) |
| D19 | 에이전트 관리·전역 설정은 SO만 — 서버 강제 | 사용자 (2026-09-27) |
| D20 | 스택: TypeScript 풀스택(React + NestJS + PostgreSQL + Drizzle) | 사용자 (2026-09-27) |
| D21 | 인증: SSO(OIDC/SAML) 수신 측만, 역할은 앱 관리, 개발은 Keycloak | 사용자 (2026-09-27) |
| D22 | **크로스플랫폼**: 최종 실행 Windows. Docker는 개발 의존 서비스만, api·web은 Node로 직접 실행, 셸 문법 없는 스크립트, `path`만, LF, CI ubuntu+windows. 배포 방식은 S5 | 사용자 (2026-09-28) |
| D23 | 서버 세션은 DB `app_session`(쿠키 토큰의 SHA-256만 저장, 기본 12시간). DDL 초안에 추가해 1:1 유지 | S0 기본값 (2026-09-28) |
| D24 | 최초 SO는 `INITIAL_SYSTEM_OWNERS`(SSO `sub` 또는 `preferred_username`) — 로그인 때 부여만 하고 해제하지 않음 | PRD §2 · S0 기본값 |
| D25 | 라이선스 UNLICENSED, LICENSE 파일 제거. NOTICE는 오케스트레이션 규칙의 제3자 고지로 유지 | 사용자 (2026-09-28) |
| D26 | api는 ESM + tsc 빌드(데코레이터 메타데이터), DI는 모두 명시적 `@Inject(토큰)` — 테스트 변환기(oxc)와 무관하게 동작 | S0 기본값 |
| D27 | SSO 사용자 식별은 `(issuer, sub)` — `app_user.sso_subject`에 `{issuer}#{sub}`로 저장(IdP 교체 시 권한 승계 방지) | codex-critic 리뷰 반영 (2026-09-28) |
| D28 | 대응표 U1–U9 **모두 (a)** — 데모 기능 100% 수용. U7(JSON 내보내기·초기화)만 서버 DB 백업으로 의도적 대체, 가져오기는 S5 이관 도구. 근거는 [parity-matrix §10](next-project/parity-matrix.md) | 사용자 (2026-09-28) |
| D29 | git: 병합은 **merge commit(`--no-ff`)**, squash 금지(테스트 먼저·작은 커밋 이력 보존) · 커밋 언어 한국어(접두 영어) · G3(운영 파일 공개 여부)는 첫 push 전 결정 | 사용자 (2026-09-28) |
| D30 | 오케스트레이터(Fable 5.1)는 계획·판단·통합·검증·소통만, 구현은 워커(codex-main·claude-main) 위임. 작업 단위·write_scope를 좁혀 승인, 결과는 테스트·scope_check 검증 후 `[VERIFICATION]` | 사용자 (2026-09-28) |
| D31 | **실제 사내 OpenWebUI 연동·실제 데이터 테스트는 사내에서만** 가능(이 개발 환경에서는 접속 불가). S1의 실환경 확인([real-env-verification](evaluation/real-env-verification.md))은 킵하고 사용자가 사내에서 수행. 개발·검증은 가짜 OpenWebUI + **OpenAI 등 다른 OpenAI 호환 API로 전환 가능한 프리셋**(base URL·키는 서버 설정)으로 진행 | 사용자 (2026-09-28) |
| D32 | 배포는 **Windows 서버**, PostgreSQL은 필요 시 설치해 사용. 이번 목표 페이즈에서 **SSO는 미연계** — 대체 인증 방식은 결정 대기(§6) | 사용자 (2026-09-28) |
| D34 | **인증(A1)**: 앱 자체 로그인. 로그인 ID = 계정 식별자(별도 이메일·사번 없음), 비밀번호는 Node 내장 `crypto.scrypt` 해시(네이티브 빌드 회피, D22). **회원가입은 아주 단순하게**(ID·비밀번호만) → 가입 직후 기본 사용자, SO·BO는 SO가 부여(S4). 최초 SO는 `INITIAL_SYSTEM_OWNERS`=ID — **부트스트랩 1회**: SO가 한 명도 없을 때 그 ID로 가입하는 첫 사용자만(codex-critic 리뷰 반영, 로그인 시 부여 없음). S0의 OIDC 경로는 `AUTH_MODE=oidc` 설정 선택으로 남기고 기본은 `local`(후속 페이즈 SSO 연계용). 세션 쿠키·`app_session`은 그대로 | 사용자 (2026-09-28) |
| D35 | **코드 관리**: 관리가 필요한 병렬 단계·병렬 상태는 하드코딩하지 않고 **코드(공통 코드) 데이터로 관리**한다. 최소 대상: assistant 관리 구분(1단계·2단계 각각), 그 외 상태 관련 정보. 코드 관리 화면·API의 구체 형태는 구현 시점(S4)에 사용자와 논의. PRD FR-63 | 사용자 (2026-09-28) |
| D36 | **코드 관리 1차 설계(FR-63, S2-1a)**: 공통 코드 테이블 `code_group`·`code`, assistant `level1/level2`는 코드 참조. 프로그램 로직이 분기하는 상태(task·SR·요청 status)는 check 제약 유지(전이 규칙·테스트가 값에 묶임). 관리 화면·API는 S4 | 사용자 (2026-09-28, S2-kickoff) |
| D37 | **BO 역할 저장(KI-2, S2-2a)**: `app_user.is_business_owner boolean` — SO와 같은 패턴, SO∧BO 조합 가능. `roles`의 `requester`가 여기서 나옴. 지정 화면은 S4 | 사용자 (2026-09-28) |
| D38 | S2 세부: 완료 기준은 데모 E1 S1·S3·S4(parity 배정) · 태스크 4개 순차 · PC 간 실시간은 S3 SSE · 파일 한도는 설정값(50 MB/20개) · 업무 코드 `WK-YYYY-NNNN` 서버 발급 · 개발 시드 `pnpm db:seed`(운영 거부) · S2 파일 접근은 로그인 사용자 전원 · S2 E2E는 LLM 호출 없음 | 사용자 (2026-09-28, [S2-kickoff §세부 결정](next-project/S2-kickoff.md)) |
| D41 | **S4 세부 결정 확정**([S4-kickoff.md](next-project/S4-kickoff.md)) — 모두 추천안: S4-1 비밀번호는 본인 변경 + SO 임시 비밀번호 발급(다음 로그인 때 변경 강제) · S4-2 코드 그룹은 시스템 정의, SO는 코드만 관리 · S4-3 에이전트 이미지는 로그인 사용자 전원 열람·업로드는 SO · S4-4 요청자(BO)는 자기 SR 첨부와 "결과 공유"에 담긴 파일만 · S4-6 완료 리포트는 데모 형식 · S4-7 노트 첨부는 자료함 파일 참조 · S4-8 알림은 데모 4종 · S4-9 리포트 집계는 데모 정의 · S4-10 시스템 어시스턴트는 데모 그대로(live 도구 정의 전송, mock 규칙 기반). 태스크 순서: admin → sr → task-extras → notify-reports → system-assistant | 사용자 (2026-10-01) |
| D40 | **DB 엔진 전환**: PostgreSQL 16 → **MariaDB**(단독 설치, 기준 11.8 LTS·호환 하한 10.4). D20·D32의 DB 부분을 대체. 방식은 이관(기존 테스트를 기준으로 DB 계층만 재작성), 옮길 운영 데이터 없음 → 초기 마이그레이션 1개로 재시작. 계획·매핑 규칙·검수 관문: [db-mariadb-plan.md](next-project/db-mariadb-plan.md) | 사용자 (2026-09-30) |
| D39 | **S3 상세 설계 확정**([S3-design.md](next-project/S3-design.md) 개정 1) + D3-1~7 모두 추천안: SR 스코프 미리 개방 · 보조 호출 기록 없음 · 스냅샷 파일 임계 1 MiB · 이벤트 버퍼 5분/1000건·15 s·resync · 완료 대화 추정 허용 · **대화 삭제는 소프트 삭제로 전환**(`task.deleted_at`) · 멱등 키 헤더 필수 | 사용자 (2026-09-28) |
| D33 | 역할 호칭: **SO = System Owner, BO = Business Owner(= PRD의 요청자, SR 접수 현업)**. "담당자"는 에이전트를 컨트롤하는 사람이라는 뜻일 뿐 권한 등급이 아님 → 로그인한 기본 사용자(`member`). 권한 등급은 기본 사용자·SO·BO 셋 | 사용자 (2026-09-28) |

## 6. 진행 현황

### 완료 — S2 (2026-09-28, `main` 병합 · 태그 `s2-done`)

- ① 카탈로그: 코드 테이블(D36)·BO 역할(D37)·개발 시드·카탈로그 읽기 API·허브 카드(검색·Lv1/Lv2 필터)
- ② 대화: `/api/tasks`(지연 생성 + `firstMessage` 원자 저장, WK 코드 advisory lock, 상태 전이·재개 사유, 완료 잠금 트랜잭션), 태그·자동완성, 팀 의견, 활동 이력, 초안/대화 화면, 칸반, RelatedStrip, ModelPicker
- ③ 파일: `/api/files`(업로드 한도·버전 체인·스트리밍·산출물·소프트 삭제 참조 보호), ☑/★ 입력 선택·버전 전환, 직접 태그 공유 후보, 자료함·컴포저 첨부·산출물 저장
- 검증: 단위 222 · DB 38 · E2E 7(home·tasks·files = 데모 E1 S1·S3·S4) · CI 5잡 녹색. codex-critic 리뷰 3회(16건) 반영. ④ e2e 태스크는 ③에 흡수
- **이월**: 카드 OpenWebUI 링크 기본 규칙(U9, S4) · 첨부 개수 표시 한도(KI-7, S4 설정 API) · 초안 생성 요청의 idempotency key(S3) · Windows E2E(KI-6)

### 완료 — S1 (2026-09-28, `main` 병합 · 태그 `s1-done`)

- ① 앱 자체 로그인(D34): `AUTH_MODE=local` 기본, 회원가입·로그인·최초 SO 부트스트랩 1회, 로그인 CSRF Origin 검사. OIDC는 `oidc` 모드·Keycloak 프로필로만
- ② 서버 대리 호출 기반(D31): `LLM_MODE`·`LLM_PRESET`(openwebui/openai-compatible)·`GET /api/llm/models`·`/status`, `LlmPorts` DB 어댑터 1차(S2·S3 메서드는 NotImplemented 명시), `FileStorageService`(realpath 루트·내부 링크 거부·Windows 예약어), 웹 모델 목록·SO 배지
- 검증: 단위 165 · DB 15(가짜 OpenWebUI 계약 포함) · E2E 2 · CI 5잡(ubuntu·windows) 녹색. codex-critic 리뷰 2회(9건) 반영
- **미완(이월)**: OpenAI 실키로 모델 목록 수동 확인(사용자 키 미제공 → 사내 확인 때), Windows PC 실기 확인

### 완료 — S0 뼈대 (2026-09-28, `main` 병합 · 태그 `s0-done`)

- 커밋(`feat/s0-skeleton`): 루트 설정 → domain·llm 이식(codex-main) → compose → contracts → Drizzle 스키마·마이그레이션 → api 골격 → web 셸 → e2e → CI → 문서
- 검증: 단위 125개(domain 61 · llm 41 · contracts 3 · api 14 · web 6) · DB 통합 5개(초안 SQL ↔ 마이그레이션 대조 포함, schema.ts ↔ 마이그레이션 드리프트는 단위) · E2E 2개(실제 Keycloak 로그인 → 빈 허브 → 로그아웃, SO 역할) · typecheck · lint 녹색 (macOS)
- 네이티브 의존: node-gyp 빌드 없음. 플랫폼 바이너리(rolldown·lightningcss·tailwind oxide·oxlint·esbuild)는 모두 Windows x64 사전 빌드 제공

### 남은 일

| 우선 | 항목 | 메모 |
|---|---|---|
| 이월 | Windows PC에서 [setup/windows.md](setup/windows.md)대로 회원가입 → 빈 허브 확인(문서 명령은 CI가 검증, 사람 확인만 남음) · OpenAI 실키 모델 목록 1회 | 사용자 |
| 조사 | **회사 PC에서 저장소 받기**: 저장소를 public으로 두는 이유 — 회사에서 GitHub 로그인이 안 됨. 대안 조사 필요(읽기 전용 fine-grained PAT·deploy key·release zip·사내 미러) — 회사 망에서 github.com 도달 여부부터 확인 | 사용자 (2026-09-28) |
| S4 | 코드 관리 화면·API(SO), SO·BO 지정 화면 — DDL은 S2 ①에서(D36·D37) | PRD FR-63 |
| **남은 위험** | ① 실제 Windows 실기 미확인(문서 명령은 PowerShell 7.6으로 검증, CI windows 잡은 push 후) ② 실제 사내 OpenWebUI 미확인 — 이 Mac에서 사내 OpenWebUI 접속 가능 여부가 S1 첫 관문, 막히면 S2 이후 계획이 바뀐다 | KI-4 · [real-env-verification.md](evaluation/real-env-verification.md) |
| ~~DB 전환~~ 병합 완료 | D40. `feat/db-mariadb` → `main` 병합(`1eb0335`), 태그 `db-mariadb-done`. 되돌림 기준점 태그 `pre-mariadb`(PostgreSQL 마지막 상태). 검증: 단위 232 · DB 85(11.8 3회 연속·10.4) · E2E mock 10·live 11, 구조 대조 일치, codex-critic 스키마 리뷰 4건·코드 리뷰 3건 반영, CI 7잡 녹색(Windows 설치 가이드 잡이 MariaDB 11.8 MSI로 설치·마이그레이션·DB 테스트까지 실행). 남은 확인: 사내 PC에서 설치 가이드 4장 (b) 경로 실기, macOS Homebrew 경로 | tasks/db-mariadb · [db-mariadb-plan.md](next-project/db-mariadb-plan.md) |
| **진행(S3)** | [S3-design.md](next-project/S3-design.md) 확정(D39). ① `s3-request` 완료·병합(839ed7c). **② `s3-context` 착수**(`feat/s3-context`, MariaDB 전제 반영) → ③ `s3-tray-events` | tasks/s3-context |
| ~~S1 ②~~ 병합 완료 | 서버 대리 호출 기반 `feat/s1-llm-proxy` — `LLM_MODE`·`LLM_PRESET`(openwebui/openai-compatible)·`GET /api/llm/models`·`/status`, `LlmPorts` DB 어댑터 1차, `FileStorageService`(realpath 루트·내부 링크 거부), 웹 모델 목록·SO 배지. codex-critic 4건+누락 1건 반영. 검증 단위 165·DB 15·E2E 2, CI 5/5(Windows 8.3 경로·CI 환경 의존 2건 수정 후). **OpenAI 실키 수동 확인은 사용자 키 필요** | tasks/s1-llm-proxy |
| ~~S1 ①~~ 병합 완료 | 앱 자체 로그인·회원가입(D34) `feat/s1-auth-local` — codex-main 구현 + codex-critic 리뷰 4건 반영. 검증 단위 142·DB 9·E2E 2. CI 녹색 확인 후 `main` 병합(사용자 승인) | tasks/s1-auth-local · [요구사항 검토](status/requirements-review-2026-09-28.md) |
| 착수 전 확인 | OpenWebUI 버전(사용자 추후 회신), 비기능 제안값(PRD §6), **사내 모델의 도구 호출(function calling) 지원 여부**(S4-10 — 미지원이면 시스템 어시스턴트가 제안 카드 없이 답만 냄) | next-project/README |
| 중간 | IdP 로그아웃, 요청자 역할 저장 | [KNOWN_ISSUES](../KNOWN_ISSUES.md) KI-1·KI-2 |

## 7. 주의사항 (함정)

- **공개 저장소**: 사내 주소·사내 AI 포털 주소·양식 번호·참고 이미지·이미지에서 옮긴 문구·실명 커밋 금지. 커밋 전 `git grep`. 비밀값은 `.env`(무시됨)만, `.env.example`은 로컬 개발용 가상 값
- **스키마 정본은 `apps/api/src/db/schema.ts`**(D40 이후. `postgres-draft.sql`은 전환 전 기록). 스키마를 바꾸면 `db:generate`로 마이그레이션을 만든다 — 빠뜨리면 `schema-drift` 테스트가 깨진다. 마이그레이션은 손으로 고치지 않는다
- **MariaDB 규칙**([db-mariadb-plan.md](next-project/db-mariadb-plan.md) §3): DB는 `utf8mb4_nopad_bin`으로 만든다(`utf8mb4_bin`은 끝 공백을 무시). 키·인덱스 컬럼은 `varchar(191)` — 값이 그대로 저장되는 입력은 API에서 길이를 검증해 400. `returning` 없음 → 맞은 행 수(`affectedRows`)나 재조회. `for share` 문법 없음. `INSERT IGNORE`·`GET_LOCK` 금지. 식별자(제약 이름) 64자 제한. MariaDB 10.4는 json을 문자열로 돌려준다(스키마의 json 타입이 객체로 바꾼다). 잠금 순서는 `db_lock` → task → thread → chat_request, 같은 종류는 오름차순
- 연결마다 세션을 고정한다(`db/connection.ts`: UTC·READ COMMITTED·엄격 모드). 서버 설정에 기대지 않으므로 DB 서버의 기본값이 달라도 동작이 같다. 풀을 직접 만들지 말고 `createPool`을 쓴다
- 드리즐 인덱스의 `.desc()`는 `NULLS LAST`를 붙인다 — 초안과 맞추려면 `sql\`${col} desc\``
- Drizzle 순환 참조(`file_object`↔`task` 등)는 `.references((): AnyMySqlColumn => …)`로 타입을 끊는다
- 워크스페이스 패키지를 런타임(node)에서 쓰려면 `dist`가 있어야 한다 — `pnpm build` 또는 api `dev`(선행 빌드 포함)
- Vite `resolve.conditions`만으로는 vitest(SSR 환경)에 안 먹는다 — `vitest.shared.ts`의 `ssr.resolve.conditions`까지 써야 한다
- Keycloak realm의 `${ENV}` 자리는 컨테이너 환경 변수로 치환된다. realm을 바꾸면 컨테이너를 다시 만들어야(`docker compose up -d --force-recreate keycloak`) 다시 임포트된다
- Keycloak 사용자 프로필 검증은 이름에 괄호 등 특수문자를 막는다 — 걸리면 로그인 뒤 "프로필 수정" 화면이 끼어 E2E가 멈춘다. `name` 클레임은 `firstName lastName` 순서
- 웹은 `/api/me`의 401이 아닌 오류를 두 번 재시도한다(api `dev` watch 재시작 중 502 대비)
- 로그인 방식은 `AUTH_MODE`(기본 `local`). `oidc`일 때만 `OIDC_*`가 필수이고 Keycloak은 compose `--profile oidc`로만 뜬다. local에서 SSO 경로는 404, oidc에서 signup/login은 404
- `INITIAL_SYSTEM_OWNERS`는 부트스트랩 전용 — SO가 아직 없을 때 목록의 ID로 가입(또는 OIDC 첫 로그인)하는 사용자만 SO. SO가 생긴 뒤에는 목록이 무시된다. 배포 직후 관리자가 먼저 가입해야 한다
- 가입·로그인 POST는 `Origin`이 `APP_ORIGIN`과 다르거나 `Sec-Fetch-Site: cross-site`면 403(로그인 CSRF 방지). 프록시 뒤에서 `APP_ORIGIN`이 실제 브라우저 주소와 다르면 로그인이 막힌다
- `sso_subject` 형식을 `{issuer}#{sub}`로 바꾸기 전에 로그인한 개발 DB 사용자는 다음 로그인 때 새 사용자로 생긴다 — 개발 DB는 `docker compose down -v`로 초기화
- 기능 대응표 [next-project/parity-matrix.md](next-project/parity-matrix.md)가 데모 수용 범위의 정본 — 이식할 때 데모 소스를 직접 연다
- CI Windows 러너에서 DB 클라이언트가 비밀번호 프롬프트를 띄우면 잡이 무한 대기한다(PostgreSQL 시절 setup-guide 잡 33분 정지). MariaDB 전환 뒤에는 `ankane/setup-mariadb`가 root를 비밀번호 없이 띄우고, 사람용 절차만 `$env:MYSQL_PWD`를 쓴다
- 마이그레이션 0002(S2 ①)는 `assistant.level1/level2`를 코드 FK 컬럼(NOT NULL, 기본값 없음)으로 교체한다 — **기존 assistant 행이 있는 DB에는 적용이 실패**한다. S0·S1에는 에이전트 생성 경로가 없어 실제로는 빈 테이블이지만, 손으로 넣은 개발 DB는 `docker compose down -v`(또는 DB 재생성) 후 `db:migrate` → `db:seed`
- 데모 저장소는 읽기 전용 — 수정·커밋 금지
- 요청은 서버 RequestService만 보낸다(S3). 트레이 추정은 `buildChatRequest({ dryRun: true })` — 실제 전송과 같은 함수
- 대화 생성은 `POST /api/tasks` 한 번(`firstMessage`로 첫 팀 의견까지 같은 트랜잭션). 클라이언트 인계(autoSend) 경로는 없다 — 생성 요청 자체의 네트워크 재전송 중복(idempotency key)은 S3 RequestService와 함께
- 완료된 대화의 수정·태그·팀 의견은 서버가 트랜잭션 안에서 행을 잠그고 재검사해 409 — 클라이언트 검사만 믿지 않는다

## 8. 다음 세션 시작 체크리스트

1. `pnpm install` → `docker compose up -d --wait` → `pnpm db:migrate` → `pnpm typecheck` · `pnpm test` · `pnpm test:db` · `pnpm test:e2e` 녹색 확인
2. 이 문서 6장(남은 일)과 KNOWN_ISSUES 확인, S1은 [evaluation/real-env-verification.md](evaluation/real-env-verification.md)부터
3. 기능 작업은 `feat/*` → 테스트 먼저 → 작게 커밋 → 민감 문자열 검사 → push·`main` 병합은 사용자 승인 후
4. 문서: [README](../README.md) · [next-project/](next-project/README.md)(PRD·architecture·openapi) · [fusion-design.md](fusion-design.md) · [evaluation/context-flow.md](evaluation/context-flow.md)
