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
  events/      GET /api/events SSE(메모리 이벤트 버스·재전송 버퍼) · POST /threads/:id/typing · 서비스는 커밋 뒤 발행
  context/     참조 대화(후보·선택·스냅샷·요약 초안·삭제 보호)
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
| D42 | **push·병합 규칙**: 기능 브랜치는 Orchestrator 검증(typecheck·lint·단위·DB 11.8/10.4·E2E)과 CI 전 잡 녹색이면 **push와 `main` 병합(`--no-ff`)까지 자동**, 사후 보고. 되돌림은 merge commit 기준. 사용자가 미리 보고 싶은 건은 그때 지정 | 사용자 (2026-10-01, "병합 후 승인" — 제안 (b)로 해석) |
| D43 | **S5 결정 S5-1~7 모두 추천안**: web은 api가 단일 포트로 정적 제공(IIS는 선택) · Windows 서비스는 WinSW · 비기능 값은 PRD §6 제안값(전부 설정값) · 요청 원본 JSON 1년 정리는 SQL 안내만 · 이관 도구는 데모 bundle 전체(비밀값 제외) · CI windows-latest E2E 추가 · SSE는 단일 인스턴스 전제 + 프록시 설정 문서. 태스크 순서 deploy → nonfunctional → import-tool → windows-ci. [S5-kickoff.md](next-project/S5-kickoff.md) | 사용자 (2026-10-02, "나머지 추천안으로 진행") |
| D44 | **사내 운영·개발 분리(S6)**: 회사는 설정·데이터만 관리하고 개발은 이 저장소에서 원격으로 한다(테스트 결과는 대화로 전달). 배포는 회사 PC의 **git pull → pnpm release**(zip 배포 없음). 설정(`.env`)·파일 저장소·로그·백업은 저장소·배포 묶음 **밖** 폴더에 두고, 회사 데이터(에이전트 카탈로그·코드·SR 접수 에이전트·사용자)는 사내 DB에만(관리 화면). 메뉴: **일반 담당자도 SR 접수 가능**, BO는 SR 접수만(허브·대화·리포트 불가). 순서: ① 긴급 수정(randomUUID·가입 이름·BO 차단·SR 접수 에이전트 기본값) → ② 환경 분리·진단 화면 → ③ SR 화면 보강(감사 높음 5) → ④ 나머지 갭·대응표 "화면 동작" 열 | 사용자 (2026-10-07, "일반 담당자도 SR 접수 가능 / zip 불필요, git pull / 허가") |
| D45 | **S6 디자인 기준 확정**(tasks/s6-design-direction 명세): 시각 토큰 재정의·다크 모드(사용자별, 서버 프로필)·한/영(새 의존성 없는 형식 사전)·칩/배지·텍스트+추천 입력(`SuggestInput`). 분류 코드는 이름 입력 시 자동 추가, **자동 생성분만** 미사용 시 자동 제거(기존 샘플·SO 작성 유지). "사용 예시" 칩 유지(필드명 "첫 질문 예시"), "사용법 보기"는 모델·OpenWebUI·문서 링크 칩으로. 에이전트 ID 비노출·서버 생성, 새 대화 담당자 배정 제거. Pretendard 글꼴 self-host(새 의존성). SR 접수=“내 SR 요청”/관리=“SR 처리” 구분, 접수 대화는 첫 전송 때 생성, SR 반려·완료·미완료 체크 완료는 사유 필수. 순서: ② 환경 분리·진단 → U1 토큰 → U2 테마·언어 → U3 i18n 기반 → U4 부품 → U5–U7 → U8–U9(SR) → U10 → U11. 취향 판단이 크면 사용자에게 다시 묻는다 | 사용자 (2026-10-08, "추천대로 진행") |
| D46 | **S7 현장 피드백 반영**(전문가 패널 합의 tasks/s7-ux-panel/artifacts/s7-spec.md): 메뉴 업무/요청/관리 3구획·사용자 관리 분리, 에이전트 분류는 Lv1›Lv2 **경로 여러 개**(조인 테이블 0006·백필 0007, 구형 대표 컬럼은 동기화 유지·삭제는 사내 실기 후), 허브 필터 다중·URL 정본, **기본 모델은 .env `LLM_DEFAULT_MODEL`만**(DB 값 무시·설정 PATCH 400), AI 연결은 화면 표시+연결 시험만(주소·모드·키 .env), SO 시험 대화(기록 없음·전역 응답 상한 공유), 카드 밀도 (a), 기존 에이전트별 OpenWebUI 링크는 보존하고 '재정의 있음·지우기'로 표시, 진단 메뉴명 '연결 진단', 칩: 단일 선택 + 없음·다중만 +/× | 사용자 (2026-10-08·09) |
| D47 | **S8 다듬기**(전문가 패널 5턴 합의 tasks/s8-polish-panel/artifacts/s8-spec.md): 기능 영향 없는 UI/UX 다듬기(톤 토큰·대비 ≥4.5 계산 테스트·원시 색 스캔, 탭 키보드, 트레이 계산 중 유지, 입력창 'AI 요청 입력'/'팀 의견 입력', 상단 '같은 태그 대화', 모바일, 자료 패널 상태·다운로드 실패 안내·32px 조작 영역). 사용자 결정: 기본 탭 '이력' 유지+빈 대화 [자료 열기], **팀 의견 첨부 기본 '이번 메시지만'**, 말풍선 첨부 미리보기·다운로드 | 사용자 (2026-10-09) |
| D48 | **S9 현장 요청 반영**(2026-10-13): 계정 이메일(선택 컬럼, 미설정이면 응답에서만 `{loginId}@DEFAULT_EMAIL_DOMAIN` — 도메인은 `.env`, 백필 없음), 탐색기 드래그 업로드(대화·초안은 입력창 첨부 대기, 자료 패널은 저장 — 서버 로컬 파일 저장), '내 작업' 메뉴, 태그 연결 정확도(**번호 형식 규칙·표기 정규화 없이 자유 태그** — Enter는 입력값 그대로, SR 자동완성·접수됨/미접수/확인 불가, 트레이에 실제 포함 SR, 초안 같은 태그 미리보기·태그별 묶음), 선택형 직접 HTTPS(`.pfx`/PEM, 미설정이면 HTTP 그대로), **기본 모델은 SO가 전역 설정 화면에서 변경 — DB → `.env` → 기본값, 재기동 없음**(D46의 '.env만'을 대체, 새 키 `defaultModelOverride`, 구형 `defaultModel` 행은 계속 무시) | 사용자 (2026-10-13) |
| D49 | **SR 상태 단순화**: 화면은 접수됨 → 처리 중 → 결과 공유 → 완료 + 반려(`reviewing`은 접수됨으로 표시), 처리 중·결과 공유는 자동 전환, 수동은 완료·반려·다시 열기만(서버 강제). **DB 상태 값은 그대로**(사내 데이터). 완료 사유는 현행 필수 유지 — 선택으로 바꿀지 사용자 답변 대기(`srReasonRequired` 한 곳) | 사용자 (2026-10-13, "자동으로 넘어가면 인정") |
| D50 | **S9-8 대화창·카드·칸반 UX**(전문가 패널 5턴 합의 tasks/s9-card-kanban-panel/artifacts/s9-spec.md): 메시지 복사·다시 묻기(텍스트 프리필 → 일반 전송, 원본 불변·이전 문답 선형 누적, 보관된 실패 시도가 있으면 차단)·질문 목차·새 답변으로, 카드 진행 수 상시·요약 토글, 대화 헤더 사내 어시스턴트 바로가기, 칸반 AI 상태 칩(응답 중·실패·중단)·필터·빠른 전환·초안 보존(메모리, 새로고침·로그아웃·사용자 변경 시 폐기). 다음: 2열 분할 보기. 향후: AI 생성 파일 → 자료함(사내 응답 형식 확인 후, 자동 저장·형식 추측 파서 금지), OpenWebUI 대화 연동(설계 메모만) | 사용자 (2026-10-13, 패널 권장안 — 무응답 시 권장안 진행) |
| D51 | **S10 응답 대기·OpenWebUI 연동 보정**(조사 tasks/s10-openwebui-research): 생각 과정(`reasoning_content`·`reasoning`·`<think>`)을 별도 스트림으로 받아 생존 신호로 쓰고 화면에 스트리밍(생각 중 펼침·본문 시작 시 접힘, `message.reasoning` 저장, **다음 문맥·추정·요약에서 제외**), 기본 대기 첫 응답 5분·첨부 10분·무응답 5분(기존 `.env` 값 우선), 경과 시간 표시. OpenWebUI는 API 호출에 assistant의 도구·기본 기능을 자동으로 붙이지 않음 → **SO 설정 '도구 전달' 자동(기본)/끔**: 모델 메타의 toolIds·defaultFeatureIds를 `tool_ids`·`features`·`function_calling:legacy`로 전달, **실행되지 않았음이 확실할 때만(형식 거부 4xx·연결 전 실패) 기본 방식 1회 폴백**(끊김·5xx·타임아웃은 중복 실행 방지로 재전송 안 함), 실제 방식은 요청 기록(`chat_request.owui_tools`)에. 화면과 동일한 내장 URL 읽기(session_id 경로)는 보류. SO 전용 'OpenWebUI 진단'(허용 목록 출력 — 본문·키·주소 비노출, 저장 없음) | 사용자 (2026-10-13) |
| D52 | **진행 상태 자동 관리(최소안)**: 완료·보류 진입은 사람만. 보류 중 전송 → 자동 진행 복귀(기록 auto, 1클릭 되돌리기), 완료 대화 전송 → 재개 확인, 진행 중 7일 무활동 '정체' 표시(상태 불변), '대기' 선택지 숨김. 스키마 변경 없음 | 사용자 (2026-10-13, 권장안 — 무응답 시 진행 고지) |
| D53 | **S11 대화 UX·태그 조합·SR 큐·AI 도우미**(전문가 패널 5턴 + 세부 설계 tasks/s11-ux-panel/artifacts/s11-spec.md): U1 대화 기본기(맨 아래로·코드 복사·대화 내 검색·Ctrl+K·이력 요청 1행·에이전트 이름·새 활동 점 — 목록 활동 시각으로 판정, 추가 조회 0) · U2 같은 태그 펼침 패널에서 대화 본문·파일(버전 체인 라디오) 골라 담기(기본 무체크·순차·부분 실패 표시) · U3 SR 미착수·내 연결 SR·경과일·실시간 갱신·작성 보존 · U4 **AI 도우미 알약**이 상단 시스템 assistant 버튼을 대체(드래그·위치 기억·키보드, 기본 위치 사이드바 하단, 회사 캐릭터는 SO 업로드 — 저장소에 이미지 없음, 형식·CRC·크기 검사) · U5 페이지별 '할 수 있는 것'(이동·예시 프리필만)·첫 사용 튜토리얼 · U6 도우미 말풍선(한도 근접/초과·응답 지연, 벨과 분리). 보안 핫픽스: SR 접수 초안은 요청자만, 입력 중 표시는 SR 접근 권한자만 | 사용자 (2026-10-13, 패널 권장안 — 무응답 시 진행 고지) |
| D54 | **첨부는 항상 대화 자료**: '입력으로 고정/이번 메시지만' 전환을 없앤다. AI 요청 첨부는 대화 입력으로 남아 다음 질문에도 함께 가고 ×로 뺀다. 팀 의견 첨부는 AI 입력에 넣지 않는다(S8 결정 유지). 트레이 이름 'AI에 함께 보내는 자료' | 사용자 (2026-10-14, "대화 세션이 유지되는 거잖아") |
| D55 | **OpenWebUI 세션 모드**(S12): 화면과 같은 방식(session_id·chat_id·id, user_message 생략 → 우리가 조립한 messages 그대로)으로 보내 builtin 도구(URL 읽기 등)를 켜고, 소켓(JWT 전용) 대신 채팅 GET 1초 폴링으로 받는다. **서비스 계정 하나**(사용자 계정 연동 없음) — 개인 신원이 필요한 도구가 확인될 때만 연동 검토. `LLM_OWUI_MODE` auto(기본, 시작 단계 4xx·형식 불일치만 direct 폴백)·session·direct, 완료 뒤 OWUI 채팅 삭제(`LLM_OWUI_CLEANUP`). 2단계 도구 생성 파일 → 자료, 3단계 설정 UI·정리 작업. 근거 tasks/s12-owui-session/workers/claude-main/result.md | 사용자 (2026-10-14, "일단 진행해보자") |
| D56 | **S12 다듬기**: 관리 표 열 정렬(폐기 맨 아래·상태 색 칩 공용), 에이전트 편집·전역설정·내 정보는 저장 버튼 없이 필드별 즉시 저장(확인이 필요한 동작만 버튼), 링크1 규칙에 `{modelId}`가 없으면 OpenWebUI 주소로 보고 `?model=` 부착, 상단 다크모드·언어 토글, **추천 첫 질문은 에이전트별 1회 AI 생성·저장**(SO 예시 우선, 대화마다 숨은 호출 안 함), 보낸 즉시 입력 비우기·첫 응답 전 경과 표시, 달성도 점검 스트리밍(30초 고정 제한 → 본 요청 기준), 카드 필터·대화창 상단 2줄 정리 | 사용자 (2026-10-14, 추천 질문 A안·정리안 '추천대로') |
| D57 | **AI 도우미 적극화**(S13): 페이지·사용자별 1회 '이 화면에서 도와드릴까요?' 제안(알약 위, 버튼 외 클릭 통과·뷰포트 clamp), 창 안 페이지별 빠른 실행 + 모든 페이지 '가이드해 주세요', 스포트라이트 가이드 투어(실제 요소 파란 테두리, 다음·이전·Enter·Space·Esc, 대상 없는 단계 건너뜀, 단계는 코드 데이터 + `data-tour`), 드래그는 rAF·transform. AI 호출 없음. 옛 창 안 텍스트 튜토리얼은 대체 | 사용자 (2026-10-15) |
| D58 | **대화 3줄 요약 카드**(S13): 무슨 대화(AI)·질문 수·참여자·경과(서버 계산)·다음 제안(AI). 진입 시 새 메시지가 있고 AI 답이 1개 이상이면 보조 호출 'brief'로 백그라운드 생성, `task_brief`(0013)에 기준 seq와 함께 저장, SSE `brief.updated`. **표시 전용** — 요청 조립·트레이·참조 요약에 넣지 않는다(자동 요약 금지 원칙 유지), 'AI 요약·제안'으로 표시해 플랫폼 절차로 보이지 않게 한다 | 사용자 (2026-10-15, "ai로 자동 프롬프팅") |
| D59 | **접속 주소 여러 개**: 로그인 출처 검사는 유지하고 허용 목록을 `APP_ORIGIN` + `APP_EXTRA_ORIGINS`(origin만, 경로·와일드카드 거부)로 넓힌다. 콜백·Secure 쿠키는 `APP_ORIGIN` 기준. **사내 첨부 차단(DLP)은 우회하지 않는다** — 보안 프로그램이 허용하는 다른 도메인으로 위장하는 방식은 돕지 않고 IT 허용 등록으로 푼다 | 사용자 (2026-10-15) |
| D60 | **OWUI 화면 기본값 그대로 전송**: `owuiDefaults(meta)`가 tool_ids·skill_ids·filter_ids·features(기본 기능∩capability)·terminal_id를 OWUI 화면(Chat.svelte setDefaults)과 같게 채운다(메타 5분 캐시). 지식은 세션 모드에서 OWUI 서버가 적용. OWUI가 **호출 계정 권한**으로 다시 거르므로 서비스 키 계정 권한(기능 권한·도구/스킬 공유)은 1회 설정 — 진단과 에이전트 편집 'OpenWebUI 연결 확인'(모델 호출 없음)이 ✅/❌로 보인다. SR 접수도 같은 경로 | 사용자 (2026-10-15, "어시스턴트 설정을 바꾸는 대로 그대로 적용") |
| D61 | **자료 스테이징(D54 개정)**: 파일과 참고 대화 모두 **그 질문에 한 번만** 간다. 자료함(위: 이 대화·같은 태그 파일·같은 태그 대화·연결 SR 첨부)에서 담으면 '다음 질문에 보낼 자료'(아래·입력창 트레이와 같은 상태)에 오르고 요청 시작 때 서버가 원자적으로 비운다(`chat_request_input`에 기록, 재시도는 기록 기준). 자료함에 '쓴 적 있음', 내 파일 제거(올린 사람). 'AI 입력' 용어 폐기. SR 접수 파일도 그 턴만·SR 자료함, 연결 업무에는 접수 때 올린 SR 파일 전부 | 사용자 (2026-10-15, A안 "이 대화에 쓴 적 있음") |
| D62 | **SR AI 자동작성·AI로 다듬기 분리**: 자동작성은 접수 대화 전체로 초안 제안, 다듬기는 현재 글을 뜻 유지로 다듬고 빠진 점은 본문 대신 '추천' 목록. 둘 다 제안만(적용은 사람), 첫 토큰·무응답 기준, 실패·폴백은 시트 안 안내. 요청자(BO) 허용 경로에 compose·refine 추가(기존 다듬기 403 결함) | 사용자 (2026-10-15) |
| D63 | **처리자 중심 SR 상세·대화 새 창·완료 알림**: SR 상세는 행동·요청 내용 위, 접수 대화 기본 접힘. 대화는 '새 창으로 띄우기'(팝업에는 사이드바·알약 없음). 내가 보낸 답이 끝났는데 그 대화를 보고 있지 않으면 본창 도우미가 제목·첫 문장·[바로 가기]로 알린다(AI 호출 없음) | 사용자 (2026-10-15) |
| D64 | **튜토리얼 섹션화**: 페이지 투어를 섹션(목록·진행·건너뛰기·다시 보기, 사용자별 저장)으로. 대화·자료함(대화 담기 포함)·칸반·에이전트 편집 가이드. '필요한 순간' 트리거는 **모델 선택 클릭** — '이 대화에만 적용' 안내 + SO는 [에이전트 설정 열기]로 편집 시트의 해당 항목을 '여기예요'로 짚는다 | 사용자 (2026-10-15) |
| D41 | **S4 세부 결정 확정**([S4-kickoff.md](next-project/S4-kickoff.md)) — 모두 추천안: S4-1 비밀번호는 본인 변경 + SO 임시 비밀번호 발급(다음 로그인 때 변경 강제) · S4-2 코드 그룹은 시스템 정의, SO는 코드만 관리 · S4-3 에이전트 이미지는 로그인 사용자 전원 열람·업로드는 SO · S4-4 요청자(BO)는 자기 SR 첨부와 "결과 공유"에 담긴 파일만 · S4-6 완료 리포트는 데모 형식 · S4-7 노트 첨부는 자료함 파일 참조 · S4-8 알림은 데모 4종 · S4-9 리포트 집계는 데모 정의 · S4-10 시스템 어시스턴트는 데모 그대로(live 도구 정의 전송, mock 규칙 기반). 태스크 순서: admin → sr → task-extras → notify-reports → system-assistant | 사용자 (2026-10-01) |
| D40 | **DB 엔진 전환**: PostgreSQL 16 → **MariaDB**(단독 설치, 기준 11.8 LTS·호환 하한 10.4). D20·D32의 DB 부분을 대체. 방식은 이관(기존 테스트를 기준으로 DB 계층만 재작성), 옮길 운영 데이터 없음 → 초기 마이그레이션 1개로 재시작. 계획·매핑 규칙·검수 관문: [db-mariadb-plan.md](next-project/db-mariadb-plan.md) | 사용자 (2026-09-30) |
| D39 | **S3 상세 설계 확정**([S3-design.md](next-project/S3-design.md) 개정 1) + D3-1~7 모두 추천안: SR 스코프 미리 개방 · 보조 호출 기록 없음 · 스냅샷 파일 임계 1 MiB · 이벤트 버퍼 5분/1000건·15 s·resync · 완료 대화 추정 허용 · **대화 삭제는 소프트 삭제로 전환**(`task.deleted_at`) · 멱등 키 헤더 필수 | 사용자 (2026-09-28) |
| D33 | 역할 호칭: **SO = System Owner, BO = Business Owner(= PRD의 요청자, SR 접수 현업)**. "담당자"는 에이전트를 컨트롤하는 사람이라는 뜻일 뿐 권한 등급이 아님 → 로그인한 기본 사용자(`member`). 권한 등급은 기본 사용자·SO·BO 셋 | 사용자 (2026-09-28) |

## 6. 진행 현황

### 완료 — S13 후반 OWUI 기본값·자료 스테이징·SR·튜토리얼 (2026-10-15, `main` 병합, D60–D64)

- J OWUI 기본값 미러링·권한 점검 · K SR 끌어 놓기 · L SR AI 자동작성/다듬기 · M SR 처리 상세 · N SR 첨부 → 업무 자료함 · P·S 자료 스테이징 · Q 대화 새 창·완료 알림 · R·T 튜토리얼 섹션화·대화 담기 장면
- 검증으로 잡은 결함: 요청자 BO 세션 가드에 SR refine·compose 누락(403), 투어가 탭을 연 뒤 패널 커밋 전에 대상을 재서 스포트라이트 사라짐, 첫 진입 제안 기타. live E2E 바이트 불일치는 배경 AI 제목 변경과의 경합(제품은 추정 재계산)
- 사내 확인 필요: 서비스 키 계정의 기능 권한(웹 검색·코드 실행)·도구/스킬 공유 — 에이전트 편집 'OpenWebUI 연결 확인'에서 ❌ 항목만 OWUI 관리자에게 요청
- 다음: OWUI 세션 2단계(도구 생성 파일 → 자료), 사내 세션 동작 확인 결과 반영

### 완료 — S13 도우미 적극화·대화 요약 카드 (2026-10-15, `main` 병합, D57–D59)

- F 첫 진입 제안·빠른 실행·스포트라이트 가이드 투어·부드러운 드래그 · G 대화 3줄 요약 카드(마이그레이션 0013) · H `APP_EXTRA_ORIGINS`
- 검증으로 잡은 결함: 390px에서 첫 진입 제안이 입력창 아래 모델 버튼을 가림(→ 알약 위·버튼 외 포인터 통과), 알약을 위로 옮기면 제안이 화면 밖, 마이그레이션 0013 뒤 Windows CI DB 테스트 30초 초과
- 사내 확인 필요: `pnpm db:migrate`(0013), `APP_ORIGIN`이 경로 없는 origin인지(경로가 있으면 기동 실패), 별칭 접속 시 `APP_EXTRA_ORIGINS`
- 다음: OWUI 세션 2단계(도구 생성 파일 → 자료) · 3단계 · 요약 카드는 진입 시에만 갱신(보는 중 새 답은 다음 진입 때)

### 완료 — S12 현장 다듬기·OpenWebUI 세션 1단계 (2026-10-14, `main` 병합, D54–D56)

- 첨부 전환 제거(D54) · A 즉시 비우기·대기 표시·달성도 스트리밍 · B 표 정렬·즉시 저장·링크1 · C 상단 토글·추천 첫 질문(마이그레이션 0012) · E OWUI 세션 모드 1단계(D55) · D 카드 필터·대화창 상단 정리
- 검증으로 잡은 결함: 달성도 점검이 30초에 조용히 규칙 판단으로 바뀜, 세션 폴링이 마지막 상태만 전달해 짧은 'URL 읽는 중'이 사라짐, 390px에서 그리드 암시 열이 최소 내용 폭으로 늘어 가로 넘침, 즉시 비우기 뒤 E2E가 서버 저장 전에 다음 단계로 진행
- 사내 확인 필요: `pnpm db:migrate`(0012), `.env` `LLM_OWUI_MODE=auto`·`LLM_OWUI_CLEANUP=true`, URL 질문에 'URL 읽는 중' 표시·실제 읽기, 실패 시 '사용한 자료 → 원본 JSON'의 mode·오류, 서비스 키의 `/api/v1/chats`·`/api/tasks`·`/api/v1/files` 허용·채팅 삭제 권한, 사용자 정의 도구의 파일 출력 방식
- 다음: 세션 2단계(도구 생성 파일 → 자료) · 3단계(설정 UI·진단·고아 채팅 정리) · S11b 잔여

### 완료 — S11 대화 UX·도우미 (2026-10-14, `main` 병합, D53)

- U1–U6 + 보안 핫픽스(SR 초안·presence). 리뷰로 잡은 결함: 담기 재시도가 옛 선택 전송·대화 전환 시 선택 이월, 칸반 카드마다 메시지 전체 조회(N+1)로 멈춤, 도우미 알약이 모바일·우하단에서 전송 버튼을 가림, 이미지 헤더만 있는 PNG 통과, 대기 중 연결 종료 시 모델 호출, 늦은 초안 응답이 최신 SR 덮어씀, 말풍선 오발화
- E2E 신뢰성: 병렬 2 workers·Windows에서만 나던 간헐 4건(라우트 중복 처리·전체 대화 수 비교·스크롤 즉시 단언·후속 요청 식별) 제거
- 다음(S11b): 일괄 담기 API, '같은 태그 새 파일'·연결 끊김 말풍선, 전환 목록 마지막 메시지, 스포트라이트 투어, 도우미 페이지별 AI 기능, 도우미 창 제목('시스템 assistant'→'AI 도우미')

### 완료 — S10 응답 대기·OpenWebUI 연동 (2026-10-13, `main` 병합, D51·D52)

- S10-1 말풍선 톤별 링크·코드 대비, 질문 목차 버튼 겹침 해소 · S10-2 생각 과정 스트리밍·대기 5분/10분·경과 시간 · S10-3 도구 전달·안전한 폴백 · S10-4 진행 상태 자동 관리 · S10-5 SO OpenWebUI 진단
- 리뷰로 잡은 결함: 진단 출력 유출 경로 6건(→허용 목록), 폴백이 끊김에도 재전송해 중복 실행 위험, 도구 전달 저장이 일반 설정 미저장 값 소실
- 테스트 신뢰성: E2E에서 dev-owner 가입 409가 IP 시도 제한에 누적 → 로그인 먼저, Windows `import.db` 테스트당 마이그레이션 → 1회+행 비우기
- 사내 확인 필요: `.env` 타임아웃 3줄 갱신, `pnpm db:migrate`(0010·0011), URL 읽기 assistant 실제 질문, 'OpenWebUI 진단' 카드 캡처(버전·도구 설정)

### 완료 — S9 현장 요청 (2026-10-13, `main` 병합, D48–D50)

- S9-1 계정 이메일 · S9-2 탐색기 드래그 업로드 · S9-3 '내 작업' · S9-4 태그 연결 정확도 · S9-5 선택형 HTTPS · S9-6 기본 모델 전역 설정 · S9-7 SR 단순화 · S9-8 U1 메시지 동작 · U2 카드·바로가기 · U3 AI 상태(서버·화면)
- 리뷰로 잡은 결함: 태그 후보 인덱스 선택(재정렬 시 다른 번호), 권한 밖 SR을 '미접수'로 단정, 설정 저장이 다른 SO의 모델 변경을 되돌림, 보관된 실패 시도 중 다시 묻기가 다른 질문을 전송, SR 자동 전환이 닫힌 SR을 재개하는 경합, AI 상태 쿼리 window 비용(211→2.4 ms), 큰따옴표 Windows 경로
- api 테스트 간헐 실패 근본 원인 제거(루프백 명시 바인딩)
- 사용자 확인 필요: SR 완료 사유 선택 여부, 사내 실기 때 OpenWebUI 파일 응답 원문(마스킹) 1건

### 완료 — S8 파일 검증·다듬기 (2026-10-09, `main` 병합, D47)

- 파일 시나리오 23건 정밀 검증(tasks/s8-file-scenarios/artifacts/file-scenarios.md): **결함 5건 수정** — 한글·이모지 업로드 파일명 깨짐(multipart latin1), 공유 출처에 내부 대화 ID 노출, **SR 태그 대화 요청에 연결 SR 본문 누락**(태그 소문자 키 vs binary 정렬), 이관 SR 태그 표기 정규화, 이 대화 파일 순서
- main CI 실패 수정: 병렬 데이터 갱신 중 허브 주소 정규화가 옛 뷰를 되살림(문자열 비교·매 렌더 효과·라우터 stale prev) → 내용 비교·메모
- 전문가 패널 5턴(Codex·agy·Opus·Fable) → A0 키 · A1 토큰/대비 · A2 탭 키보드 · A3 트레이/입력창 · A4 상단/모바일 · A6 자료 패널 · A7 자료 열기/첨부 미리보기
- **AI 응답 파일(OpenWebUI가 응답에 파일을 실어 보냄)은 미지원** — 사내 OpenWebUI 응답 형식 확인 후 서버 대리 다운로드로 구현(범위 제안 file-scenarios.md I-1). 산출물로 저장한 AI 답변은 업로드 파일과 같게 동작(검증됨)
- 사용자 확인: 허브 검색 한글 입력, 사내 OpenWebUI 연결 시험·시험 대화, 대화 첨부 미리보기

### 완료 — S7 현장 피드백 (2026-10-09, `main` 병합, D46)

- 0 즉시 수정: 화면 모듈 로드 실패 시 1회 자동 새로고침·'새 버전' 안내(셸 유지), dev api 반복 재시작(Node `--watch-path`+`--env-file`이 저장소 루트를 무필터 감시) → `--watch`
- 전문가 패널(Codex 개발·QA·보안 / agy 디자이너·고객 1–3 / Opus PM / Fable 리더) 3라운드 합의 → 명세 tasks/s7-ux-panel/artifacts/s7-spec.md
- Wave 1: A 메뉴 3구획·사용자 관리 페이지·로딩 뼈대 / E SR 빈 상태 4상태(데이터 기반 안내) / D 분류 경로 다중화(마이그레이션 0006·0007, 이관은 기존 분류 유지) / C1 연결 진단 AI 카드·연결 시험·시험 대화(limitedFetch, admit 전역 상한 공유)
- Wave 2: C2 기본 모델 .env 정본(effectiveDefaultModel — 요청·SR·요약·체크리스트 점검·시스템 assistant·진단·시험), B 허브 다중 필터·카드 밀도·내 진행 중 대화·관리 표 읽기 전용·편집 시트(경로 편집기·모델 선택·시험 대화·기존 링크 지우기)·칩 문법
- 각 단위 Opus 리뷰 → 수정 → CI 녹색 → D42 병합. 대응표 ⬜ 0
- **사용자 확인 필요**: ① 업그레이드 시 `pnpm db:migrate` 전 백업(분류 경로 마이그레이션, 되돌림은 백업 복원만) ② 설정 화면에서 저장해 쓰던 기본 모델은 `.env` `LLM_DEFAULT_MODEL`로 이전 ③ 사내 OpenWebUI RAG 응답이 큰 경우 일반 대화 정상 여부(시험 대화만 상한) ④ 시험 대화 모델 없음은 상위 404로 판정(사내 연동 시 보정) ⑤ 허브 검색창 한글 입력 수동 확인

### 완료 — S6 UI/UX (2026-10-08, `main` 병합 · 태그 `s6-done`, D44·D45)

- ② 환경 분리·진단(`s6-env`)·배포 안전(`s6-deploy-safety`)·현장 수정(`s6-hotfix`: 요청자 이름, BO 허브 차단, `crypto.randomUUID` 대체, API 키 위치)
- U1 토큰(oklch 라이트·다크) → U2 테마·언어(사용자별 서버 저장, 0004) → U3 i18n 기반 → U4 부품(Sheet·Popover·Checkbox·RadioGroup·Tabs·Badge·Chip·Field·SuggestInput·Picker) → U5–U7(분류 코드 자동 추가·자동분만 제거 0005, 에이전트 ID 서버 생성·비노출, 모델 링크 칩, select 제거)
- U8 SR 분리: "내 SR 요청"(2열·공용 채팅·첫 전송 지연 생성 멱등) / "SR 처리"(표·필터·Sheet). BO는 SR만, 초안 접수 원문은 요청자·SO만
- U9 SR 흐름: 단계 전이·반려/완료 사유 필수(activity_log)·상태 이력·한글 알림, 전환 Sheet(첨부 선택=접수 본문 메시지 정본·후보 분리, AI 다듬기는 제안만, 수동 편집 보존), 필수 체크 미완료 업무 완료 사유 필수
- U10 마감: 편집·서랍 Sheet, ConfirmDialog, Checkbox/Switch/Field, NAV 통일, 칸반 배지·WK 줄바꿈, `HEAD /`
- U11 한/영: features 한국어 리터럴 0(상한 테스트), ko·en 키 693 일치
- 워커: Codex 한도 이후 Fable·Opus 병행(worktree 병렬), 매 단위 Opus 리뷰 → 수정 → CI 녹색 → D42 병합. 대응표 ⬜ 0
- **사용자 확인 필요**: ① 사내에서 이전 코드로 데모 백업을 이미 이관했다면 SR 접수 첨부가 비어 보임 → 새 DB에 재이관(보정 스크립트 없음) ② 필수 체크 미완료 업무 완료는 이제 사유 필수 ③ 요청 기록 있는 SR 초안은 삭제 불가(감사 보호, 버튼 숨김) ④ 영문에서 만든 새 에이전트의 기본 체크리스트는 영어로 저장
- **남은 것**: 로컬 개발 DB 비대로 E2E 간헐 실패(S3·S8·tray) — E2E 전용 DB 분리 결정 대기, api 단위 테스트 간헐 실패 2회(원인 미확인), React "script tag" 콘솔 경고(next-themes, 무해)

### 완료 — S5 (2026-10-02, `main` 병합 · 태그 `s5-done`)

- ① 배포(`s5-deploy`): api 단일 포트 정적 제공·`pnpm release` 묶음(링크 0)·WinSW v2.12·Windows 운영 절차(중지 → 백업 → 교체), CI가 Windows에서 묶음 복사본 기동 검증. Windows 전용 결함 2건(심볼릭 링크, 8.3 짧은 이름 realpath)
- ② 비기능(`s5-nonfunctional`): PRD §6 값 설정화, 동시 응답 상한 20, 보안 헤더·CSP, 세션 만료, 시도 제한, 감사 기록 보호, 리포트 조회 필터·인덱스(0003), 규모 시드 측정(주요 화면 p50 ≤ 535 ms), 번들 분할
- ③ 이관 도구(`s5-import-tool`): `pnpm db:import` — 데모 백업 v1–3, 멱등·조용한 손실 금지·번호 재발급·dry-run. 리뷰 6회
- ④ Windows CI(`s5-windows-ci`): windows E2E 잡, 첫 메시지 표시 결함·시도 제한 동시성 결함 수정
- 검증(④ 기준): 단위 323+ · DB 169(MariaDB 11.8·10.4) · E2E mock·live·windows · CI 8잡. 대응표 ⬜ 0
- **남은 것(사용자)**: 사내 Windows 서버 WinSW 설치·`TRUST_PROXY` 판단, 데모 백업 이관 dry-run, 사내 OpenWebUI 연동(D31)·모델 function calling 확인, GMP 보존 기준(1년 정리)

### 완료 — S4 (2026-10-02, `main` 병합 · 태그 `s4-done`)

- ① 관리·설정·권한(`s4-admin`, 7738b41): 에이전트 관리 API·화면(SO 서버 강제, revision 충돌, 삭제 보호, 이미지), 전역 설정, 코드 관리, SO·BO·활성 지정, 비밀번호 변경·임시 비밀번호(마이그레이션 0001). 리뷰 반영
- ② SR(`s4-sr`, 79fb221): 접수 전환(`SR-YYYY-NNNN`)·제목 권한·연결 업무(`task.sr_id`, 마이그레이션 0002)·상태·결과 공유, 요청자 범위 서버 강제, 이벤트 수신자 필터
- ③ 업무 보조(`s4-task-extras`, e053218): 체크리스트·AI 달성도·노트·완료 절차 한 트랜잭션·완료 경로 일원화·활동 이력
- ④ 알림·리포트(`s4-notify-reports`, 41ed9d6): 알림 4종 서버 기록·본인 조회·읽음·SSE 벨, `/reports` 서버 집계(요청자 403, SR 리드타임은 `sr.status_changed` 활동 기준, 담당자 필터). 리뷰 6건 중 5건 반영, 전량 적재는 KI-9
- ⑤ 시스템 assistant(`s4-system-assistant`): 서버 대리 호출(시스템 프롬프트·도구 정의 서버 주입, mock 규칙/live 도구 호출, 메시지 수·길이·요청 크기 한도, 연결 종료·시간 초과 시 모델 호출 중단, 기록 없음) → 제안 카드(적용 인자 전부 표시·도구별 스키마 검증) → 사용자 "적용" 뒤에만 기존 API(대화 시작 멱등 키, 에이전트 등록 SO만, 태그 추가). 리뷰 5건 전부 반영. E2E로 드러난 관리 화면 결함(목록 로드 전 "순서 편집" → 빈 초안) 수정
- 검증(⑤ 기준): 단위 303 · DB 140(MariaDB 11.8·10.4) · E2E mock 26·live 25(가짜 OpenWebUI는 도구 호출을 못 내므로 live는 "답변만" 경로 검증) · CI 7잡 녹색. 대응표 S4 행 전부 ✅(남은 ⬜ 1 = S5 이관 도구)
- **이월**: 사내 모델의 도구 호출 지원 확인(미지원이면 제안 카드 없이 답만 — 설계대로) · 리포트 조회 비용(KI-9) · SSE 프록시(KI-8) · Windows E2E(KI-6) · 가입 제한(KI-5) · 번들 분할(KI-3)

### 완료 — S3 (2026-10-01, `main` 병합 · 태그 `s3-done`)

- ① 요청 서비스(`s3-request`, 839ed7c): `chat_request` 상태 기계·대화당 진행 중 1건·SSE 스트리밍·중지·재시도·시간 제한·lease·정리·멱등 키·OpenWebUI 파일 전달·요청 기록. 리뷰 11건 반영
- (사이) DB 엔진 전환 D40(`db-mariadb-done`): PostgreSQL → MariaDB, 계획·매핑 규칙 [db-mariadb-plan.md](next-project/db-mariadb-plan.md)
- ② 참조 대화(`s3-context`, 8cf6259): 직접 태그 공유 후보·선택 3모드·스냅샷 고정·갱신·요약 초안(보조 호출)·삭제 보호·새 대화 참조 지정. 결함 수정: 메시지 순서는 `seq`(같은 밀리초의 질문·답변), 삭제 시 자기 참조 입력 정리. 데모 테스트 10건 대응
- ③ 추정·이벤트·presence(`s3-tray-events`): 추정 API(전송과 같은 조립 함수·동일성 계약 — 빈 초안·첨부 순서까지), `/api/events` SSE(커서·5분/1000건 재전송·resync·15 s 하트비트·배압 시 단절), typing presence(5 s), 트레이·한도 초과 차단·다른 PC 진행 표시·폴링 제거. 리뷰 6건 반영
- 검증(③ 기준): 단위 256 · DB 101(MariaDB 11.8·10.4) · E2E mock 17·live 17 · CI 7잡 녹색. 대응표 S3 21행 전부 ✅(남은 ⬜ 35)
- **이월**: SSE 프록시·다중 인스턴스(KI-8, S5) · 업로드 뒤 한도 초과로 막힌 파일은 자료함에 남음(사람이 정리) · 사내 모델 도구 호출 지원 확인(S4-10)

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
| **남은 위험** | ① ~~실제 Windows 실기 미확인~~ → 사내 Windows PC에서 MariaDB 11.8 설치·앱 동작 확인(사용자, 2026-10-01) ② 실제 사내 OpenWebUI 미확인 — 이 Mac에서 사내 OpenWebUI 접속 가능 여부가 S1 첫 관문, 막히면 S2 이후 계획이 바뀐다 | KI-4 · [real-env-verification.md](evaluation/real-env-verification.md) |
| ~~DB 전환~~ 병합 완료 | D40. `feat/db-mariadb` → `main` 병합(`1eb0335`), 태그 `db-mariadb-done`. 되돌림 기준점 태그 `pre-mariadb`(PostgreSQL 마지막 상태). 검증: 단위 232 · DB 85(11.8 3회 연속·10.4) · E2E mock 10·live 11, 구조 대조 일치, codex-critic 스키마 리뷰 4건·코드 리뷰 3건 반영, CI 7잡 녹색(Windows 설치 가이드 잡이 MariaDB 11.8 MSI로 설치·마이그레이션·DB 테스트까지 실행). **사내 PC 실기 확인 완료(2026-10-01, MariaDB 11.8 설치·동작 — 사용자)**. 남은 확인: macOS Homebrew 경로 | tasks/db-mariadb · [db-mariadb-plan.md](next-project/db-mariadb-plan.md) |
| ~~진행(S3·S4)~~ 완료 | S3 `s3-done`(D39). S4 `s4-done`(D41) — ①~⑤ 모두 `main` 병합(위 "완료 — S4"). **진행(S5)** — D43 확정(2026-10-02). ① `s5-deploy` 완료·병합(a51ff5e — 정적 제공·`pnpm release`·WinSW·Windows 배포 절차, CI가 Windows 묶음 기동 검증. 리뷰 7건 반영 + Windows에서만 드러난 결함 2건: 묶음 심볼릭 링크, 8.3 짧은 이름 realpath) → ② `s5-nonfunctional` 완료(동시 응답 상한·보안 헤더·세션 만료·시도 제한·감사 보호·리포트 조회 필터·번들 분할, 규모 시드 측정 — 대화 상세 화면 API 합계 p50 535 ms·첫 실행 max 1.36 s(콜드), 나머지 ≤ 335 ms) → ③ `s5-import-tool` 완료·병합(333bd99 — 데모 백업 이관 CLI, 대응표 ⬜ 0. 리뷰 6회·구현 7차: 부분 ID 충돌, 서버 시드와 같은 ID, 번호 중복, 태그 키, v1 보충 등 실제 백업에서만 드러나는 결함을 실제 데모 시드 fixture(실명 가상화)로 고정) → ④ `s5-windows-ci` 완료(CI windows E2E 잡, 첫 메시지 표시 간헐 결함·시도 제한 동시성 결함 수정). **S5 완료(`s5-done`)** — 기능 개발 단계 종료, 대응표 ⬜ 0. 다음: 사용자 사내 실기(WinSW 서비스 설치·데모 백업 이관·사내 OpenWebUI 연동·function calling 확인) 결과에 따른 보정 | tasks/s4-* · [S4-kickoff.md](next-project/S4-kickoff.md) |
| ~~대조 검증 후속~~ 완료 | 최초 계획·데모 대조 감사(2026-10-01, codex-critic — 결함 10건, FR 판정표, 대응표 ✅ 93행 전수, 데모 테스트 161건 대응) → 즉시 수정 6건 `fix/s3-audit` 병합: 새 대화 첫 입력을 AI 요청으로(컴포저 기본 AI, 멱등 키 보존·재접속, 첨부 실패 시 대화 유지), 요청 크기 = 실제 전송 본문(로컬 파일 ID 기준, 추정=기록=한도), 말풍선 첨부 표시, 요청 기록 JSON 첨부 정보, 자료함 정렬, 기록에 참조 대화 모드, E2E 깊이 복원(가짜 OpenWebUI 수신 본문 검사). D-05는 S4 ①에서 해결 | tasks/plan-demo-audit · tasks/s3-audit-fixes |
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
- **메시지 순서는 `seq`(스레드 안 순번)로만 가른다.** 질문과 답변 메시지는 같은 트랜잭션에서 만들어져 `createdAt`이 밀리초까지 같다 — 시각으로 정렬하고 동률을 ID로 가르면 순서가 뒤집힌다(S3 ② E3d에서 발견, 도메인 `conversationContext`는 `seq` 우선). 새 정렬·경계 판정에 `createdAt`을 쓰지 말 것
- **첫 입력은 AI 요청이 기본**(데모와 동일). 초안 페이지는 대화 생성 뒤 첫 입력을 요청 서비스로 한 번만 보낸다(멱등 키·본문을 세션 저장소에 보관, 응답 유실 시 같은 키로 재접속). 첨부 실패 시 대화를 삭제하지 않는다 — 감사에서 "기본이 팀 의견"으로 돼 있던 결함을 고친 것
- **바이트 계산 계약**: 추정·기록·한도 판정은 모두 로컬 파일 ID를 넣은 본문(`messages`+`files`)으로 센다. OpenWebUI 원격 ID로 바뀐 실제 전송 본문은 길이가 조금 다르지만 계산에 쓰지 않는다(결정적이어야 추정 = 기록)
- 가짜 OpenWebUI의 `/__e2e/requests`(받은 본문 조회)는 `FAKE_OWUI_E2E=1`일 때만 — Playwright가 띄우는 전용 서버만 켠다
- **추정 = 전송**: 트레이 추정과 실제 전송은 `buildChatRequest` 하나를 쓴다. 입력 상태(빈 초안의 본문, 새 첨부의 순서, 참조 대화, 설정)까지 같아야 한다 — 어느 한쪽만 고치면 동일성 DB 테스트가 깨진다(S3 ③ 리뷰에서 두 번 어긋났던 곳)
- SSE 클라이언트는 첫 연결·범위 밖 `Last-Event-ID`에 `resync`(전체 무효화)를 받는다. 배압이면 서버가 끊고 재접속으로 복구 — 무한 버퍼링 금지
- **SR 권한은 서버 기록 연결(`task.sr_id`)로만** 판정한다. 태그(`SR-…`)는 표시·검색용이지 권한 근거가 아니다(리뷰에서 태그 위조로 권한을 얻는 경로 발견). `/api/events`도 SR 접수 스레드 이벤트는 요청자·SO·연결 처리자에게만 보낸다(재전송 버퍼 포함)
- 완료는 `POST /tasks/{id}/complete` 한 경로(피드백·리포트 파일·상태 전이 한 트랜잭션). `PATCH /status`의 `done`도 이 경로를 탄다 — 내부에서 상태만 바꾸는 완료 함수를 따로 두지 말 것(리뷰에서 이원화 발견)
- 입력 폼은 제출 시점에 비우고 요청 중 잠근다 — 응답 뒤 `setState('')`는 다음 입력을 지운다(체크리스트 항목 추가에서 E2E로 발견)
- 요청은 서버 RequestService만 보낸다(S3). 트레이 추정은 `buildChatRequest({ dryRun: true })` — 실제 전송과 같은 함수
- 대화 생성은 `POST /api/tasks` 한 번(`firstMessage`로 첫 팀 의견까지 같은 트랜잭션). 클라이언트 인계(autoSend) 경로는 없다 — 생성 요청 자체의 네트워크 재전송 중복(idempotency key)은 S3 RequestService와 함께
- 완료된 대화의 수정·태그·팀 의견은 서버가 트랜잭션 안에서 행을 잠그고 재검사해 409 — 클라이언트 검사만 믿지 않는다
- **리포트 권한·집계 기준(S4 ④)**: `/api/reports`는 요청자(BO)에게 403 — PRD §2 "내부 대화·자료는 볼 수 없음". SR 완료 리드타임은 `sr.status_changed` 활동 기록(접수·상태 변경·결과 공유와 같은 트랜잭션)에서 계산하므로 상태를 바꾸는 새 경로를 추가하면 활동 기록도 함께 써야 한다. 알림은 업무 커밋 **뒤** 전송하고 실패해도 요청은 성공(경고 로그) — 멱등 재시도가 누락 알림을 복구하지는 않는다.
- **시스템 assistant는 제안만(S4 ⑤)**: 모델의 도구 호출은 서버가 `toolCalls`로 돌려줄 뿐 실행하지 않는다. 적용은 웹에서 사용자가 "적용"을 누른 뒤 기존 API를 같은 권한으로 호출하는 경로 하나뿐 — 서버에서 도구를 직접 실행하는 코드를 추가하지 말 것. 도구 인자는 `packages/contracts`의 도구별 스키마로 검증하고 카드에 적용 인자를 전부 보여 준다(프롬프트 주입으로 바뀐 값을 사람이 보게). 서랍 이력은 클라이언트 메모리에만 있고 요청 기록도 남기지 않는다(D3-2).
- **E2E 병렬 부하와 로드 전 클릭**: 스펙이 늘수록 API가 느려져 "목록이 로드되기 전에 버튼을 누르는" 경합이 표면화된다(관리 화면 순서 편집 60 s 타임아웃). 화면은 로드 전 동작 버튼을 비활성화하고, 스펙은 목록 표시를 기다린 뒤 누른다. 5 s 기본 대기가 부족한 live 단계는 15 s.
- **Windows에서만 깨지는 것(S5 ①)**: ① `pnpm deploy` 기본 결과물은 심볼릭 링크 구조라 복사하면 `ERR_MODULE_NOT_FOUND` — 배포 묶음은 hoisted 링커로 링크 0개(`verify-release`가 검사). ② `fs.realpathSync`(JS 구현)는 8.3 짧은 이름(`RUNNER~1`)을 유지하고 `fs.promises.realpath`·`realpathSync.native`는 긴 이름으로 푼다 — 경로 포함 판정은 **같은 구현**으로 구한 경로끼리. 둘 다 macOS에서는 재현되지 않아 CI windows 잡이 유일한 관문이다.
- **이관 도구는 "실제 백업 × 시드된 서버"로 먼저 시험(S5 ③)**: 가상 최소 fixture로는 통과해도 실제 데모 백업은 서버 시드와 같은 에이전트 ID·같은 업무 번호(`WK-2026-0001`)·빈 소유자·대문자 태그를 가진다. 규칙: 카탈로그는 서버 값 유지(참조), 콘텐츠는 하위까지 대조해 다르면 중단, 번호는 재발급, 태그 키는 `tagKey`. fixture는 `apps/api/src/db/fixtures/demo-v3.json`(데모 시드에서 만들고 이름을 가상화 — 공개 저장소).


- **시간대 의존 테스트(S6)**: `Z` 붙은 시각을 로컬 형식으로 단언하면 KST에선 통과하고 CI(UTC)에서 깨진다 — 테스트 값은 시간대 없는 로컬 시각으로, 로컬 검증은 `TZ=UTC pnpm test`.
- **Field는 라벨이 입력을 감싸지 않는다(S6)**: `getByText('이름').locator('input')` 같은 DOM 구조 의존 셀렉터 금지 — `getByRole('textbox', { name })`.
- **Radix Sheet/Dialog를 트리거 없이 열면**(상태로 open) 닫을 때 포커스가 body로 간다 — `onOpenAutoFocus`에서 연 요소를 기억하고 `onCloseAutoFocus`에서 돌려준다.
- **SR 접수 첨부 정본(S6 U9)**: 접수 본문 메시지(role user·kind discussion·authorId null)의 첨부만 `attachmentIds`, 이 SR에 올라간 파일 전체는 `candidateAttachmentIds`. 이관 도구·새 경로도 같은 메시지에 붙여야 한다.
- **worktree 병렬 작업**: E2E는 포트·DB를 공유하므로 한 번에 하나만. 워커는 E2E를 돌리지 않고 오케스트레이터가 실행. 동시에 돌면 부하 플레이크 — 실패 spec은 `--workers=1`로 재확인.

- **가입 409·틀린 비밀번호는 ID 실패로 센다(시도 제한)**: E2E에서 기존 계정에 가입을 먼저 시도하는 패턴은 실패가 누적돼 뒤 spec의 로그인이 429로 막힌다 — 시드 계정은 바로 로그인한다(S7 B에서 34건 중 다수 연쇄 실패).
- **Node `--watch-path`와 `--env-file`을 함께 쓰지 말 것**: env 파일 디렉터리(저장소 루트)를 무필터 재귀 감시해 git·로그 쓰기마다 재시작한다 — `--watch`(모듈 그래프 + env 파일만)를 쓴다.
- **`<dd aria-label>`은 Chromium 접근성 이름으로 노출되지 않는다**: E2E는 `term` → `following-sibling::dd`로 찾는다.
- **Codex 샌드박스는 Chromium을 띄우지 못한다**: E2E 실행은 오케스트레이터가 한다. 워커가 띄운 dev 서버가 3000/5173에 남으면 E2E가 그 서버를 재사용하므로 먼저 종료한다.

- **주소(URL)를 다시 쓰는 효과는 '내용이 다를 때만, 커밋된 location당 1회'**: 문자열 비교·매 렌더 새 배열 의존성·라우터 함수형 갱신의 stale prev가 겹치면 병렬 데이터 갱신 중 사용자 전환을 덮어쓴다(S8 main CI). CI는 다른 spec이 동시에 데이터를 만들므로 로컬 직렬에서 재현되지 않는다 — 부하 스크립트로 재현.
- **태그는 표기(label)와 키(소문자)가 다르다**: binary 정렬 컬럼과 비교하는 코드(SR 코드 등)는 정규화된 표기로 조회한다(S8 T-06).
- **multer는 기본 latin1로 파일명을 읽는다** — `defParamCharset:'utf8'`(S8).
- **Radix ToggleGroup의 역할은 `toolbar`**, 테스트 경로 비교는 `path.sep`를 `/`로 정규화(Windows).

- **병렬 브랜치 연속 병합은 병합 커밋마다 종료 코드로 검증**: 각 브랜치 CI가 녹색이어도 한 브랜치가 공용 타입에 필수 필드를 더하면 다른 브랜치의 새 테스트 픽스처가 깨진다(S9 Me.email). `cmd | tail`은 종료 코드를 가린다 — 게이트(`gate.sh`)·typecheck 결과는 파이프 없이 판정한다.
- **`.env`의 Windows 경로는 작은따옴표나 `/`**: 큰따옴표 안의 `\n`은 줄바꿈으로 바뀐다(S9 HTTPS 인증서 경로 — 기동 시 제어 문자 검사).
- **api HTTP 테스트 서버는 `app.listen(0, '127.0.0.1')`**: macOS에서 와일드카드 임시 포트는 다른 프로세스의 `127.0.0.1` 리스너에 가로채인다(간헐 401/403·무응답). 테스트 셋업 가드가 와일드카드 `listen(0)`을 막는다.
- **Playwright `getByRole(name)` 문자열은 부분 일치**: '대화'가 '새 대화'에도 맞는다 — `exact: true`.

- **E2E에서 SO 계정은 로그인 먼저**: 가입 409도 로그인 시도 제한(IP당 10회/10분) 실패로 집계된다 — 전체 실행 뒤쪽 spec의 가입이 한꺼번에 막힌다(S10).
- **DB 테스트는 마이그레이션 1회 + 행 비우기**: 테스트마다 임시 DB·마이그레이션은 Windows CI에서 20초씩 걸려 30초 타임아웃을 넘는다(S10 import.db).
- **OpenWebUI API 호출은 화면과 다르다**: assistant의 도구·기본 기능은 화면이 채워 보내는 값이라 API에선 직접 보내야 한다. 생각 과정은 `reasoning_content` 등으로 오며 본문만 읽으면 '응답 없음'으로 오판한다(S10).

- **Playwright `page.route('**/api/**')`는 Vite 소스(`/src/api/*.ts`)까지 가로챈다**: `url.pathname.startsWith('/api/')`로 좁힌다(S11).
- **목록 카드 단위 조회 금지**: 카드마다 상세를 부르면 대화 수천 건에서 칸반이 멈춘다 — 목록 응답 필드로 판정(S11 새 활동 점).
- **가짜 서버 표식은 제품 코드에서 다루지 않는다**: `PRIVATE_REASONING` 같은 테스트 표식을 화면에서 지우는 로직은 실제 모델 출력에 의미가 없다(S11).
- **입력창이 비었다 ≠ 전송 완료**: 보낸 즉시 비우므로 E2E는 메시지 목록을 `expect.poll`로 기다린다(S12).
- **폴링은 사이 상태를 놓친다**: 폴링 사이에 쌓인 상태는 순서대로 모두 전달한다. 가짜 서버의 상태 지속 시간은 폴링 간격보다 길게(S12).
- **CSS grid 암시 열은 최소 내용 폭 아래로 줄지 않는다**: 모바일 단일 열도 `grid-cols-[minmax(0,1fr)]`를 명시해야 긴 모델명이 페이지를 넓히지 않는다(S12).
- **보조 요청 고정 시간 제한은 느린 사내 서버에서 조용한 폴백이 된다**: 본 요청의 첫 토큰·무응답 기준을 쓰고 폴백 사실을 화면에 표시한다(S12 달성도 점검).
- **로컬 E2E DB 누적**: 대화가 수천 건 쌓이면 칸반 카드 단언(kanban-ai·progress-auto)이 로컬에서만 실패한다. CI(빈 DB)로 판정하거나 개발 DB를 새로 만든다.
- **마이그레이션이 늘면 Windows DB 테스트가 느려진다**: 임시 DB에 전체 체인을 거는 훅·테스트는 공용 `MIGRATION_TEST_TIMEOUT_MS`(120초)를 쓴다. 전역 testTimeout은 올리지 않는다(S13, 0013 추가 시 codes.db 30초 초과).
- **E2E는 한 번에 하나만**: 포트 3000/5173·`mes_hub`를 공유하고 `reuseExistingServer`라 다른 worktree의 서버로 테스트될 수 있다. 워커에게 E2E를 허용할 때는 그 동안 오케스트레이터가 돌리지 않는다. Codex 샌드박스는 Chromium을 띄우지 못하므로 E2E 디버깅은 Claude 워커나 오케스트레이터가 한다.
- **getByRole 이름은 부분 일치**: '전송'이 '팀 의견 (AI 미전송)'까지 잡는다 — `exact: true`. 탭패널·본문 텍스트도 중복되기 쉽다.
- **live 추정=전송 단언은 배경 AI 제목 변경과 경합**: 시스템 프롬프트에 제목이 들어가므로 live 스펙의 업무는 수동 제목으로 만든다. 제품은 변경 시 추정을 다시 계산한다.
- **같은 표식을 담은 요청을 고를 때 이력도 포함된다**: 가짜 OWUI 요청 기록에서 marker로 찾으면 다음 턴(이력에 같은 문장)이 걸린다 — 다음 요청 전에 확인.
- **Windows CI 타이머 테스트는 여유를 3배 이상**: 세션 폴링·유휴 타이머 테스트가 느린 러너에서 실패 — 성질은 유지하고 시간 여유를 키운다.

## 8. 다음 세션 시작 체크리스트

1. `pnpm install` → `docker compose up -d --wait` → `pnpm db:migrate` → `pnpm typecheck` · `pnpm test` · `pnpm test:db` · `pnpm test:e2e` 녹색 확인
2. 이 문서 6장(남은 일)과 KNOWN_ISSUES 확인, S1은 [evaluation/real-env-verification.md](evaluation/real-env-verification.md)부터
3. 기능 작업은 `feat/*` → 테스트 먼저 → 작게 커밋 → 민감 문자열 검사 → push·`main` 병합은 사용자 승인 후
4. 문서: [README](../README.md) · [next-project/](next-project/README.md)(PRD·architecture·openapi) · [fusion-design.md](fusion-design.md) · [evaluation/context-flow.md](evaluation/context-flow.md)
