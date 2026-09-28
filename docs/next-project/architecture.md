# 아키텍처 — MES Agent Hub (새 저장소)

작성일: 2026-09-27 · 상태: 착수용 초안 · 요구사항: [PRD.md](PRD.md) · API: [openapi.yaml](openapi.yaml) · 데이터: [../architecture/data-contract.md](../architecture/data-contract.md)

## 1. 스택 결정 (D20)

**TypeScript 풀스택 모노레포**: React(기존) + NestJS + PostgreSQL + Drizzle.

| 기준 | TypeScript 풀스택 | Spring Boot (이전 초안) |
|---|---|---|
| 데모 소스 재사용 | 도메인 규칙·프롬프트 조립·참조 대화·OpenWebUI 전달 코드를 서버에서 **그대로** 실행 | 전부 Java로 재작성 |
| 화면·서버 간 타입 | 한 패키지의 타입·스키마를 공유 (계약 불일치 없음) | OpenAPI로 생성·동기화 필요 |
| 스트리밍(SSE)·파일 스트림 | Node 기본 기능 | 가능 |
| 익숙함 | NestJS의 모듈·의존성 주입·가드는 Spring과 같은 구조 | 사용자 경험 있음 |
| 흐름 | 사내 AI 도구·웹 서비스에서 흔한 구성 | 사내 레거시와의 일관성 |

Spring을 처음 권했던 것은 사용자의 Java 경험 때문이었다. 재사용과 계약 일관성을 기준으로 다시 보면 TypeScript 쪽이 비용이 훨씬 적다.

| 구성 | 선택 | 이유 · 대안 |
|---|---|---|
| 웹 | React 19 + Vite + shadcn/ui (**데모 그대로**) | 화면 코드 이식 |
| 서버 | NestJS (Node 22) | 모듈·가드(권한)·OpenAPI 생성·SSE. 더 가벼운 대안: Fastify/Hono |
| DB | PostgreSQL 16 | 부분 고유 인덱스(진행 중 요청 1건)·jsonb. 사내 표준 DB가 정해지면 Drizzle 방언만 바꿈 |
| ORM·마이그레이션 | Drizzle + drizzle-kit | SQL에 가까운 스키마(`postgres-draft.sql`과 1:1), TS 타입 공유. 대안: Prisma |
| 검증·계약 | zod 스키마 → OpenAPI | 웹·서버 공용 |
| 데이터 가져오기(웹) | TanStack Query + SSE 무효화 | 데모의 `useLiveQuery` 대체 |
| 인증 | **이번 페이즈: 앱 자체 로그인**(`AUTH_MODE=local`, D32·D34) + 서버 세션 쿠키. 사내 SSO(OIDC/SAML)는 후속 페이즈에 `AUTH_MODE=oidc`로 | §5 |
| 파일 | 로컬 디스크·NAS `FileStorageService` | data-contract §4 |
| 테스트 | vitest(단위·서버) + Playwright(E2E, 데모 시나리오 이식) | |
| 개발 환경 | Docker Compose: PostgreSQL + 가짜 OpenWebUI (+ Keycloak은 `--profile oidc`, SSO 대역) | |

## 2. 저장소 구조

```
apps/
  web/             React (데모 src/features·components·app 이식)
  api/             NestJS
packages/
  domain/          데모 src/domain/* — 순수 규칙 (태그·후보·예산·칸반·전이·리포트)
  llm/             데모 src/llm/* — 프롬프트 조립·SSE·provider·OpenWebUI 전달·요약·제목·달성도
  contracts/       zod 스키마·API 타입 (OpenAPI 생성 원본)
e2e/               데모 e2e/* 시나리오 이식
docs/              데모 docs/next-project·architecture·evaluation 이관
```

## 3. 데모 소스 재사용 지도

| 데모 경로 | 새 위치 | 바꿀 것 |
|---|---|---|
| `src/domain/*` (tags, conversationContext, requestBudget, kanban, transitions, titles, modelResolution, reporting, taskReport, checklistReview, srDraft, types) | `packages/domain` | 거의 그대로. `types.ts`는 contracts와 정렬 |
| `src/llm/context.ts`, `promptBuilder.ts` | `packages/llm` → 서버에서 실행 | `promptBuilder`의 `db` 직접 조회를 저장소 인터페이스 주입으로 교체 |
| `src/llm/openwebuiFiles.ts`, `openaiProvider.ts`, `sse.ts` | `packages/llm` → 서버 | 파일 바이트를 `FileStorageService`에서 읽음, 키는 서버 비밀 |
| `src/llm/conversationSummary.ts`, `title.ts`, `checklistReview.ts`, `mock*.ts` | `packages/llm` | 그대로 (Mock은 개발·E2E용) |
| `src/app/chatRunner.ts` | `apps/api` RequestService | 탭 메모리 → DB 요청 행 + 서버 작업. 생존 신호는 `lease_until`, 끊긴 요청 정리는 주기 작업 |
| `src/db/repositories/*.ts` | `apps/api` 서비스 + `apps/web` API 클라이언트 | **같은 함수 이름·인자**의 클라이언트로 교체 → 화면 코드 변경 최소화. 매핑: data-contract §6 |
| `src/db/schema.ts`, `exportImport.ts`, `seed/*`, `migrations/*` | 버림 (Drizzle 스키마·마이그레이션으로 대체) | 시드는 개발용 픽스처로만 |
| `src/features/*`, `src/components/*`, `src/app/*` | `apps/web` | `useLiveQuery` → TanStack Query, `tabUser`(사용자 전환) → 로그인 사용자, 설정 화면의 API 키 입력 삭제 |
| `e2e/*` | `e2e/` | 가짜 OpenWebUI를 서버 쪽 대역으로, 로그인 단계 추가 |

## 4. 서버 모듈

| 모듈 | 책임 |
|---|---|
| auth | SSO 로그인·세션, 현재 사용자, 역할 가드(담당자·SO·요청자) |
| users | 사용자 목록, SO 지정 |
| assistants | 카탈로그·순서(revision 충돌)·체크리스트 기본값·이미지 |
| tasks | 대화 생성·상태·제목·태그·입력 선택·체크리스트·노트·완료 리포트 |
| conversation-inputs | 후보 조회, 선택·스냅샷·갱신·요약 초안 |
| files | 업로드·다운로드·버전·산출물 표시·소프트 삭제·고아 정리 |
| requests | 요청 조립(추정 포함)·OpenWebUI 대리 호출·스트리밍·중지·재시도·끊긴 요청 정리 |
| service-requests | SR 접수·상태·연결 업무·결과 공유(요청자 공개 범위) |
| events | 사용자별 SSE 스트림 (대화·메시지·요청 변경 알림) |
| notifications, activity, reports, settings | 데모와 같은 기능, 설정은 SO 전용 |

**요청 처리 (데모 chatRunner의 서버판)**
1. `POST /threads/{id}/requests`: 트랜잭션에서 완료 여부 확인 → 사용자 메시지 + 답변 자리 + `chat_request(status=pending)` 생성. 진행 중 요청은 부분 고유 인덱스가 막는다 → 409
2. 서버 작업이 `packages/llm`으로 요청 조립 → OpenWebUI 업로드·처리 확인(실패 시 `failed` + 항목별 사유) → 스트리밍
3. 응답 조각은 SSE로 요청한 화면에 전달, 주기적으로 DB 저장, `lease_until` 갱신
4. 끝나면 답변·`chat_request_input` 확정. 서버 재시작 시 만료된 요청은 `interrupted`

## 5. 사내 SSO

> **이번 목표 페이즈는 SSO를 연계하지 않는다(D32).** 로그인은 앱 자체(ID·비밀번호, 단순 회원가입 — D34, `AUTH_MODE=local`)이며, 아래 SSO 설계는 후속 페이즈에 `AUTH_MODE=oidc`로 켜는 경로다. 코드는 S0에 만들어 두었고 Keycloak은 compose `oidc` 프로필로만 뜬다.

사내 SSO 구조를 몰라도 설계할 수 있다. 사내 SSO는 거의 모두 **OIDC** 또는 **SAML 2.0**을 지원하므로 앱은 이 표준의 "로그인 받는 쪽(Relying Party / Service Provider)"만 구현하고, 사내 값은 설정으로 넣는다.

```
브라우저 ─(1) /login ─▶ API ─(2) 리다이렉트 ─▶ 사내 IdP 로그인
브라우저 ◀(4) 세션 쿠키 ─ API ◀(3) 콜백(코드 또는 SAML 응답) ─ IdP
API: 서명 검증 → 사용자 정보(주체 ID·이름·이메일·부서) → app_user 조회/첫 로그인 시 생성 → httpOnly 세션 쿠키
```

- 구현: NestJS + Passport (`openid-client` 기반 OIDC 전략 또는 `@node-saml/passport-saml`). 방식은 설정 하나로 고른다.
- 역할: 로그인은 SSO, **역할(SO·요청자)은 앱이 관리**한다. 사내 그룹 정보가 오면 매핑 규칙으로 보조할 수 있다.
- 개발: Docker Compose의 **Keycloak**을 사내 IdP 대역으로 쓴다(OIDC·SAML 모두 지원) → SSO 없이도 개발·E2E 가능. 사내 연결은 설정 교체.
- 세션: 서버 세션 + httpOnly·Secure·SameSite 쿠키. 토큰을 브라우저 저장소에 두지 않는다.

**IT 부서 요청 체크리스트**

| # | 항목 | 예 |
|---|---|---|
| 1 | 지원 방식 | OIDC / SAML 2.0 (둘 다면 OIDC 권장) |
| 2 | IdP 메타데이터 | OIDC: issuer·discovery URL / SAML: 메타데이터 XML·URL |
| 3 | 앱 등록 | OIDC: client ID·secret(또는 인증서) / SAML: SP entity ID, 서명 인증서 |
| 4 | 리다이렉트(콜백) 주소 | `https://{앱 주소}/api/auth/callback` |
| 5 | 받을 사용자 정보(claim) | 고유 ID(사번 등)·이름·이메일·부서·(선택) 그룹 |
| 6 | 로그아웃 | IdP 단일 로그아웃 지원 여부 |
| 7 | 테스트 계정 | 개발·검증용 계정 2–3개 |

## 6. OpenWebUI 연동

- **서버가 대리 호출**한다. API 키는 서버 비밀 저장소(환경 변수·비밀 관리)에만 있다. 브라우저 CORS 설정이 필요 없다.
- 파일: 서버가 `FileStorageService`에서 원본을 읽어 업로드(버전 이름) → 처리 상태 확인 → 채팅 `files`. 재사용 ID는 `file_remote_ref`.
- **결정 필요(착수 후)**: 서비스 계정 키 하나로 호출할지, 사용자별 OpenWebUI 키를 쓸지. 서비스 계정이면 OpenWebUI에 올라간 파일의 소유자가 서비스 계정이 된다. 사내 OpenWebUI의 권한 정책을 확인한 뒤 정한다.
- 첫 스프린트에서 [real-env-verification.md](../evaluation/real-env-verification.md)를 서버 경로로 실행한다.

## 7. 파일 저장

- `FileStorageService` 인터페이스(`put`/`openRead`/`delete`/`exists`), 첫 구현은 로컬 디스크·NAS(`FILE_ROOT` 설정). S3 호환 저장소로 교체 가능.
- 업로드는 스트리밍으로 받으며 동시에 sha256·크기 계산 → `{root}/{yyyy}/{MM}/{fileId}`에 쓰기 → 메타 행 커밋(실패 시 파일 삭제).
- 다운로드는 스트리밍 + `Content-Disposition`(원래 이름). 소프트 삭제 후 참조가 없으면 배치로 정리.

## 8. 실시간

- 응답 스트림: 요청 SSE(요청한 화면).
- 다른 사람·다른 PC 반영: 사용자별 `GET /api/events`(SSE)로 "대화 X 바뀜" 같은 가벼운 알림 → 웹이 해당 쿼리를 다시 가져옴. 연결이 끊기면 폴링으로 대체.
- 입력 중 표시(데모의 presence)는 같은 이벤트 채널로.

## 9. 착수 순서 (제안)

| 스프린트 | 내용 | 완료 기준 |
|---|---|---|
| S0 | 모노레포·CI, Docker Compose(PostgreSQL·Keycloak·가짜 OpenWebUI), Drizzle 스키마·마이그레이션(DDL 초안 기준), 로그인 골격 | 로그인 → 빈 허브 |
| S1 | **실제 OpenWebUI 확인**(절차서) + 서버 대리 호출(채팅·파일) | 절차서 C·U 항목 기록 |
| S2 | 에이전트·대화·태그·파일·입력 선택 API, 웹의 저장소 함수를 API 클라이언트로 교체 | 데모 E1 **S1·S3·S4** 통과(parity §9 배정 — S2(SR 첨부)는 S4, S5(OpenWebUI 첨부 처리)는 S3. 2026-09-28 S2-3 결정) |
| S3 | 참조 대화·요청 서비스(활성 1건·스트리밍·재시도·정리)·추정 API·이벤트 SSE | 데모 E2–E5 통과 |
| S4 | SR·체크리스트·노트·알림·리포트·설정, 권한 가드 전체 | 역할별 E2E |
| S5 | 비기능 점검(크기·보관·감사), 배포, (선택) 데모 데이터 이관 도구 | 운영 준비 |

## 10. 결정 기록

| # | 결정 | 날짜 |
|---|---|---|
| D18 | 미확정 정책 12개를 추천값대로 확정 (PRD §5) | 2026-09-27 |
| D19 | 에이전트 관리(추가·수정·삭제·순서)와 전역 설정은 System Owner만 | 2026-09-27 |
| D20 | 새 저장소 스택: TypeScript 풀스택 (React + NestJS + PostgreSQL + Drizzle) — 데모 소스 재사용 우선 | 2026-09-27 |
| D21 | 인증: 사내 SSO(OIDC/SAML 표준), 역할은 앱 관리, 개발은 Keycloak 대역 — **이번 페이즈는 HANDOFF D32·D34(앱 자체 로그인)로 대체**, SSO는 후속 | 2026-09-27 |
