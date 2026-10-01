# S5 착수 계획 — 태스크 분할과 결정 (S5-1~7)

> **상태: 결정 대기(2026-10-02 초안)** — 사용자 승인 뒤 HANDOFF에 D43으로 기록하고 태스크별 워커·쓰기 범위를 승인받아 착수한다.

S5 = 운영 준비. architecture §9: 비기능 점검(크기·보관·감사)·배포·(선택) 데모 데이터 이관 도구. 기능은 S4로 끝났다(대응표 남은 ⬜ 1 = 이관 도구).
근거: PRD §6(제안값), HANDOFF D31·D32·D34, KNOWN_ISSUES KI-3·5·6·8·9, `docs/setup/windows.md` §6·§8 초안, 데모 `src/db/exportImport.ts`(bundle v1–3, 파일 본문 base64 포함).

## 태스크 분할과 순서(제안)

| 순서 | 태스크 | 내용 | 먼저 하는 이유 |
|---|---|---|---|
| 1 | s5-deploy | api가 web 정적 파일을 함께 제공(단일 주소·SPA 폴백·`/api`), 배포 폴더 생성 스크립트(node), Windows 서비스 등록(WinSW) 설정 파일·설치 절차, 환경 변수 주입, 로그 파일, 프록시 뒤 SSE 설정 문서(KI-8), `windows.md` §6·§8 확정(CI `setup-guide` 잡이 명령 실행) | 사내 실기 확인이 가장 오래 걸린다 — 먼저 넘겨야 피드백이 온다 |
| 2 | s5-nonfunctional | PRD §6 값 확정·반영(파일 50 MB·첨부 20·동시 스트림 20 상한), 세션 쿠키·헤더·경로 조작 점검, 규모 시드(대화 1,000·파일 10,000)로 조회 1초 측정, KI-9 리포트 조회 비용, KI-3 경로별 번들 분할, 감사(활동 이력·요청 기록 추가만 — 수정·삭제 API 없음 확인) | 배포 전 수치 확정 |
| 3 | s5-import-tool | 데모 bundle(JSON v1–3) → 서버 DB 이관 CLI `pnpm --filter @mes/api db:import <file>`: 사용자·에이전트·코드·업무·메시지·태그·SR·파일(메타 + base64 본문 → 저장소), 비밀값 제외, 멱등(같은 bundle 재실행 시 중복 없음), 건너뛴 항목 보고 | 대응표 마지막 ⬜ — 사내 데모 데이터를 살린다 |
| 4 | s5-windows-ci | KI-6: CI `windows-latest` E2E 잡(mock, MariaDB는 `ankane/setup-mariadb`, 가짜 OpenWebUI는 node로 직접 기동) | 사용자 실기 확인 전에 Windows 경로·브라우저 차이를 CI가 잡는다 |

완료 기준: Windows 서버에 서비스로 설치해 로그인 → 대화 → 파일 → SR 1회전(사용자 실기) + PRD §6 값이 설정·문서에 반영 + 대응표 ⬜ 0 + CI(ubuntu·windows, E2E 포함) 녹색 → 태그 `s5-done`.

## 결정 7건 — 추천안

| # | 항목 | 선택지 | 추천 |
|---|---|---|---|
| S5-1 | web 제공 방식 | (a) api 프로세스가 `apps/web/dist`를 정적 제공(단일 포트, IIS 불필요) · (b) IIS 리버스 프록시 + 정적 사이트 | **(a)** — 쿠키·SSE·OIDC 콜백이 한 주소. IIS는 선택(앞단 TLS) |
| S5-2 | Windows 서비스 | (a) WinSW(단일 exe, 로그 회전, 자동 재시작) · (b) NSSM · (c) 컨테이너 | **(a)** — 유지보수 활발, 설정 XML을 저장소에 둔다 |
| S5-3 | 비기능 값 | (a) PRD §6 제안값 그대로 확정(동시 50명·스트림 20·파일 50 MB·첨부 20·조회 1초) · (b) 사내 규모 회신 뒤 조정 | **(a)** — 전부 설정값이라 운영 중 조정 가능 |
| S5-4 | 요청 원본 JSON 1년 정리 | (a) SQL 안내만(수동, GMP 보존 기준 확인 전) · (b) 서버 배치 | **(a)** — 보존 기준이 확정되기 전 자동 삭제는 넣지 않는다 |
| S5-5 | 이관 도구 범위 | (a) bundle 전체(파일 본문 포함, 사용자는 로그인 ID만 만들고 임시 비밀번호) · (b) 에이전트·코드만 | **(a)** — 데모 사용 이력을 살린다. 비밀값·API 키 제외 |
| S5-6 | Windows E2E | (a) CI windows-latest E2E 잡(mock) 추가 · (b) 사용자 실기만 | **(a)** — 러너 비용은 늘지만 KI-6을 닫는다 |
| S5-7 | SSE 다중 인스턴스 | (a) 단일 인스턴스 전제 + 프록시 설정(버퍼링 끄기·유휴 시간) 문서 · (b) DB 폴링 브로드캐스터 | **(a)** — 50명 규모에 인스턴스 1개면 충분. KI-8은 문서로 닫고 다중 인스턴스는 후속 |

## 착수 시점에 승인받을 것

- 워커: codex-main(구현) + codex-critic(리뷰, read-only). 필요 시 claude-main(배포 절차 문서 문체).
- 쓰기 범위 제안: `apps/**, packages/**, e2e/**, .github/**, scripts/**, deploy/**, docs/setup/windows.md, docs/setup/macos.md, .env.example, package.json, pnpm-workspace.yaml` — 태스크별로 좁혀 승인.
- 사용자 몫: 사내 Windows 서버에 설치해 실기 확인(s5-deploy 뒤), 사내 모델 function calling 지원 여부 회신(S4 ⑤ 이월), GMP 보존 기준 확인(S5-4).
