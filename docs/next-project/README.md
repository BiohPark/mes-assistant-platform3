# 새 저장소 착수 자료

이 저장소(`mes-assistant-platform2`)는 데모로 마무리됐다(태그 `demo-final`). 실제 제품은 새 저장소에서 만든다. 아래 자료를 새 저장소의 `docs/`로 옮겨 시작한다.

| 순서 | 문서 | 내용 |
|---|---|---|
| 1 | [PRD.md](PRD.md) | 목적, 역할·권한, 화면, 기능 요구사항(FR), 확정 정책, 비기능, 범위 |
| 2 | [architecture.md](architecture.md) | 스택(TypeScript 풀스택), 저장소 구조, **데모 소스 재사용 지도**, 서버 모듈, SSO(IT 요청 체크리스트), OpenWebUI 대리 호출, 파일 저장, 실시간, 착수 순서 |
| 3 | [openapi.yaml](openapi.yaml) | API 초안 (OpenAPI 3.1) |
| 4 | [../architecture/data-contract.md](../architecture/data-contract.md) | 저장 분류, 불변 조건, 파일을 파일 그대로 보관, 요청 기록, 저장소 함수 ↔ REST |
| 5 | [../architecture/postgres-draft.sql](../architecture/postgres-draft.sql) | DB 스키마 초안 (전환 전 PostgreSQL 기록 — 현재 정본은 Drizzle 스키마, [db-mariadb-plan.md](db-mariadb-plan.md)) |
| 6 | [../fusion-design.md](../fusion-design.md) | 참조 대화·요청 트레이·전달 실패 처리의 설계 근거 |
| 7 | [../evaluation/context-flow.md](../evaluation/context-flow.md), `e2e/` | 회귀 기준 시나리오 (새 저장소에서 같은 기준으로 통과시킨다) |
| 8 | [../evaluation/real-env-verification.md](../evaluation/real-env-verification.md) | 실제 OpenWebUI 확인 절차 — **첫 스프린트에서 실행** |
| 9 | [../HANDOFF.md](../HANDOFF.md) | 결정 로그(D1–D21)·주의점 |

착수 전 확인: 사내 SSO 방식과 앱 등록(architecture §5), 사내 OpenWebUI 버전, 배포 환경·PostgreSQL 사용 가능 여부, 비기능 제안값(PRD §6).
