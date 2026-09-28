# MES Agent Hub

사내 AI 에이전트(OpenWebUI assistant)를 카드로 골라 대화하고, 대화끼리 태그로 느슨하게 이어 파일과 대화를 주고받는 업무 플랫폼.
데모(`mes-assistant-platform2`, 태그 `demo-final`)에서 검증한 동작을 서버 기반(서버·DB·파일 저장·SSO)으로 옮긴 실제 제품이다.

- 요구사항: [docs/next-project/PRD.md](docs/next-project/PRD.md) · 설계: [docs/next-project/architecture.md](docs/next-project/architecture.md) · API: [docs/next-project/openapi.yaml](docs/next-project/openapi.yaml)
- 현재 상태·결정·다음 단계: [docs/HANDOFF.md](docs/HANDOFF.md)

## 구성

```
apps/web            React 19 + Vite + shadcn/ui (데모 화면 이식)
apps/api            NestJS (Node 22) + Drizzle — 인증·세션·API
packages/domain     도메인 규칙 (데모 src/domain 이식)
packages/llm        요청 조립·OpenWebUI 호출 (데모 src/llm 이식, 저장소는 포트 주입)
packages/contracts  API 계약 (zod)
e2e/                Playwright
docker/             개발용 의존 서비스 설정 (Keycloak realm — OIDC 모드 전용, 가짜 OpenWebUI)
```

## 개발 환경

**처음이면 설치 가이드를 따라 한다 → [Windows (기준)](docs/setup/windows.md) · [macOS](docs/setup/macos.md).** git 규칙은 [docs/git-policy.md](docs/git-policy.md).

최종 실행 환경은 **Windows**, 개발은 macOS·Windows 어디서나 한다. 아래는 요약이며, 명령은 셸 종류(bash·PowerShell·cmd)와 무관하다.

필요한 것: Node 22 (`.nvmrc`), pnpm 10, Docker(Docker Desktop·OrbStack 등 — 개발용 의존 서비스에만 사용)

```bash
pnpm install
pnpm setup:env          # .env.example → .env (로컬 개발용 가상 값)
docker compose up -d --wait   # PostgreSQL 16 · 가짜 OpenWebUI (Keycloak은 --profile oidc)
pnpm db:migrate
pnpm db:seed             # 개발용 가상 카탈로그(운영 거부)
pnpm dev                # api http://localhost:3000/api · web http://localhost:5173
```

브라우저에서 http://localhost:5173 → 회원가입(ID·비밀번호) → 허브. `.env`의 `INITIAL_SYSTEM_OWNERS`(기본 `dev-owner`)에 있는 ID로 가입하면 System Owner.
로그인 방식은 `AUTH_MODE`: `local`(기본, 앱 자체) / `oidc`(SSO — 개발은 Keycloak, `docker compose --profile oidc up -d`).

api·web은 Docker 없이 Node로 직접 빌드·실행한다(`pnpm build` → `pnpm --filter @mes/api start`, 웹은 `apps/web/dist` 정적 파일).
운영 배포 방식(Windows 서비스 / 컨테이너)은 S5에서 정한다.

## 명령

| 목적 | 명령 |
|---|---|
| 타입 검사 | `pnpm typecheck` |
| 단위 테스트 (DB 없이) | `pnpm test` |
| DB 통합 테스트 | `pnpm test:db` (compose의 PostgreSQL 필요) |
| E2E | `pnpm test:e2e` (compose 필요, 처음 한 번 `pnpm --filter @mes/e2e install:browsers`) |
| 린트 | `pnpm lint` |
| 빌드 | `pnpm build` |
| 마이그레이션 생성 | `pnpm --filter @mes/api db:generate` (스키마: `apps/api/src/db/schema.ts`) |
| 마이그레이션 적용 | `pnpm db:migrate` |
| 개발용 시드(가상 카탈로그·코드) | `pnpm db:seed` |

DB 스키마는 [docs/architecture/postgres-draft.sql](docs/architecture/postgres-draft.sql)과 1:1이다 — 한쪽을 바꾸면 다른 쪽도 바꾸고 `pnpm test:db`로 대조한다.

## 저장소 규칙

- 공개 저장소다. 사내 주소·사내 포털 주소·양식 번호·실명·비밀값을 커밋하지 않는다(시드·테스트는 가상 데이터, 비밀값은 `.env`만 — 커밋은 `.env.example`).
- 크로스플랫폼 원칙(스크립트·경로·줄바꿈)은 [CLAUDE.md](CLAUDE.md) "크로스플랫폼 원칙"을 따른다.
- 이 폴더는 멀티에이전트 오케스트레이션(`_shared/`, `_templates/`, `CLAUDE.md`)으로 개발한다 — 제3자 고지는 [NOTICE](NOTICE).

## 라이선스

UNLICENSED — 권리 보유, 사용·배포 허가 없음.
