# Changelog

MES Agent Hub의 주요 변경. 스프린트(architecture §9) 단위로 기록한다.

## [Unreleased]

### S0 — 뼈대 (2026-09-28, `feat/s0-skeleton`)

- pnpm 모노레포(`apps/web`·`apps/api`·`packages/domain`·`packages/llm`·`packages/contracts`·`e2e`), Node 22 고정
- `packages/domain`·`packages/llm`: 데모 소스·테스트 이식(102개 통과), DB 직접 조회 → `LlmPorts` 주입
- Docker Compose(개발 의존 서비스): PostgreSQL 16 · Keycloak dev realm · 가짜 OpenWebUI
- Drizzle 스키마·첫 마이그레이션 — `postgres-draft.sql`과 1:1 대조 테스트, 서버 세션 `app_session` 추가
- NestJS: health · 설정 로딩 · Keycloak OIDC 로그인 · 서버 세션 쿠키 · `GET /api/me` · 역할 가드
- 웹: 데모 앱 셸 이식 · 로그인 게이트 · 빈 허브 · 로그아웃
- E2E: 실제 Keycloak 로그인 → 빈 허브 · CI(ubuntu·windows typecheck·lint·test, DB 통합, E2E)
