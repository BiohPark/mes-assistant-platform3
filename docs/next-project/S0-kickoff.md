# 새 저장소 착수: MES Agent Hub (S0 뼈대)

> 사용자 착수 지시(2026-09-27) 원문을 이 저장소 환경(macOS)에 맞춰 옮긴 것. 경로·브랜치명만 바꿨고 내용은 원문 그대로다.
> 환경 차이: 원문의 `D:\_Repositories\mes-assistant-platform2` → `~/workspace/github/work/mes-assistant-platform2`, 원문의 `master` → 이 저장소 기본 브랜치 `main`.

## 배경

- 데모 저장소 `~/workspace/github/work/mes-assistant-platform2` (GitHub `BiohPark/mes-assistant-platform2`, 태그 `demo-final`)가 기준 구현이다.
- 이 저장소에서 실제 제품(서버·DB·파일 저장·SSO)을 만든다.
- 데모 저장소는 읽기만 하고 수정하지 않는다.

## 먼저 읽을 것 (데모 저장소, `demo-final` 기준)

`demo-final`과 데모 `master`는 같은 커밋이다(2026-09-27 확인). 아래 문서는 이 저장소 `docs/`에도 같은 구조로 복사돼 있다.

1. `docs/next-project/README.md` → `PRD.md` → `architecture.md` → `openapi.yaml`
2. `docs/architecture/data-contract.md`, `docs/architecture/postgres-draft.sql`
3. `docs/fusion-design.md` 5·6장 (참조 대화·전달 규칙)
4. `docs/HANDOFF.md` 2장(원칙)·5장(결정 D1–D21)·7장(주의점)
5. `docs/evaluation/context-flow.md`, 데모 `e2e/`: 나중에 같은 기준으로 통과시킬 회귀 시나리오

## 지켜야 할 결정

- 플랫폼은 대화창 + 자료 주고받기 + 진행 기록만 제공한다. 업무 절차 프롬프트는 넣지 않는다(워크플로우는 OpenWebUI assistant 안에 있다).
- 같은 태그를 직접 공유하는 대화의 파일과 대화가 후보가 되고, 사람이 ☑/★로 고른 것만 AI에 간다.
- 순서 기반 인계, 자동 절단, 자동 요약, 재귀 수집은 하지 않는다.
- 파일은 디스크·NAS에 파일 그대로 보관하고, DB에는 메타데이터와 `storage_key`만 둔다.
- 스택(D20): pnpm 모노레포. React(데모 UI 이식) + NestJS + PostgreSQL + Drizzle + zod, 테스트는 vitest와 Playwright.
- 인증(D21): 사내 SSO의 OIDC/SAML 수신 측만 구현하고, 개발 중에는 Keycloak으로 대신한다. 역할(담당자·System Owner·요청자)은 앱이 관리하고 서버가 강제한다.
- 에이전트 관리와 전역 설정은 System Owner만 할 수 있다(D19).
- OpenWebUI는 서버가 대리 호출하고, 키는 서버 비밀 저장소에만 둔다.

## 이번 세션 범위: S0 뼈대

- 모노레포 구조: `apps/web`, `apps/api`, `packages/domain`, `packages/llm`, `packages/contracts`, `e2e/`
- `packages/domain`: 데모 `src/domain/*`와 그 테스트를 이식해 테스트가 통과할 것
- `packages/llm`: 데모 `src/llm/*`를 이식한다. DB를 직접 조회하던 부분은 저장소 인터페이스를 주입하는 방식으로 바꾼다. 테스트가 통과할 것
- Docker Compose: PostgreSQL 16, Keycloak(개발용 realm·테스트 사용자), 가짜 OpenWebUI
- Drizzle 스키마와 첫 마이그레이션: `postgres-draft.sql` 기준
- NestJS 골격: 헬스 체크, 설정 로딩, Keycloak OIDC 로그인, 세션 쿠키, `GET /api/me`, 역할 가드 골격
- `apps/web`: 데모 앱 셸(사이드바·상단바)을 이식하고 로그인 흐름에 연결. 빈 허브까지
- CI: typecheck·test·lint. 루트 `README.md`와 `docs/HANDOFF.md`를 새로 작성
  - 현재 루트 `README.md`·`LICENSE`·`CHANGELOG.md`·`NOTICE`·`KNOWN_ISSUES.md`·`assets/`는 multi-agent-starter가 넣은 파일이다 → 이 프로젝트용으로 교체(라이선스는 사용자에게 확인).
  - 현재 `docs/HANDOFF.md`는 데모의 HANDOFF 사본(참고용)이다 → 이 저장소의 HANDOFF로 새로 쓴다. 데모 HANDOFF는 데모 저장소 `demo-final`에 남아 있다.

**완료 기준**: `docker compose up` → 로그인 → 빈 허브가 보이고, 전체 테스트가 통과한다.

## 작업 방식

- 시작 전에 이번 세션 계획(파일 구조와 순서)을 보여 주고 승인을 받는다.
- 기능 브랜치에서 작업하고, 테스트를 먼저 쓰고, 단계별로 작게 커밋한다. push와 `main` 병합은 사용자에게 확인받은 뒤에 한다.
- 비밀값(키·client secret)은 커밋하지 않고 `.env.example`만 둔다. 실명·사내 주소·사내 자료를 코드와 문서에 넣지 않는다(시드와 테스트는 가상 데이터).
- 사용자 판단이 꼭 필요한 결정만 선택지로 질문한다. 나머지는 합리적인 기본값으로 진행하고 알려 준다.
- 끝나면 `docs/HANDOFF.md`에 상태·결정·다음 단계(S1: 실제 OpenWebUI 확인 + 서버 대리 호출)를 기록한다.

## 착수 전 환경 점검 (2026-09-27 기준, 이 Mac)

| 필요 | 현재 | 조치 |
|---|---|---|
| pnpm | 없음 | 설치 필요(예: `npm i -g pnpm` 또는 corepack) — 계획 승인 때 함께 확인 |
| Docker + Compose | 없음 | 컨테이너 런타임 선택 필요(Docker Desktop / OrbStack / colima) — **사용자 결정 사항** |
| Node 22 (architecture §1) | Node 26 (mise) | `.nvmrc`/`engines`로 22 고정 여부 결정 — 기본값: 22 LTS 고정 제안 |
