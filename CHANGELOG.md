# Changelog

MES Agent Hub의 주요 변경. 스프린트(architecture §9) 단위로 기록한다.

## [Unreleased]

### S1 — 로그인·서버 대리 호출 기반 (2026-09-28, `s1-done`)

- 앱 자체 로그인(`AUTH_MODE=local` 기본): 회원가입(ID·비밀번호, scrypt)·로그인·로그아웃, 최초 System Owner는 `INITIAL_SYSTEM_OWNERS`로 부트스트랩 1회, 로그인 CSRF Origin 검사. OIDC는 `AUTH_MODE=oidc`(Keycloak `--profile oidc`)
- `app_user.login_id`·`password_hash` 추가(마이그레이션 0001)
- 서버 LLM 설정 `LLM_MODE`·`LLM_PRESET`(openwebui/openai-compatible)·`LLM_BASE_URL`·`LLM_API_KEY`, `GET /api/llm/models`(60초 캐시)·`GET /api/llm/status`(SO)
- `LlmPorts` DB 어댑터 1차, `FileStorageService`(OS 무관 storage_key, 루트 탈출·심볼릭 링크·Windows 예약어 거부)
- 웹: /login·/signup, 모델 목록 훅, SO 전용 Mock/Live 배지
- CI: Windows `setup-guide` 잡 psql 비밀번호 정지 수정

### S0 — 뼈대 (2026-09-28, `s0-done`)

- pnpm 모노레포(`apps/web`·`apps/api`·`packages/domain`·`packages/llm`·`packages/contracts`·`e2e`), Node 22 고정
- `packages/domain`·`packages/llm`: 데모 소스·테스트 이식(102개 통과), DB 직접 조회 → `LlmPorts` 주입
- Docker Compose(개발 의존 서비스): PostgreSQL 16 · Keycloak dev realm · 가짜 OpenWebUI
- Drizzle 스키마·첫 마이그레이션 — `postgres-draft.sql`과 1:1 대조 테스트, 서버 세션 `app_session` 추가
- NestJS: health · 설정 로딩 · Keycloak OIDC 로그인 · 서버 세션 쿠키 · `GET /api/me` · 역할 가드
- 웹: 데모 앱 셸 이식 · 로그인 게이트 · 빈 허브 · 로그아웃
- E2E: 실제 Keycloak 로그인 → 빈 허브 · CI(ubuntu·windows typecheck·lint·test, DB 통합, E2E)
