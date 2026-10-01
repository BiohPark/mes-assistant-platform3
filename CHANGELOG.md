# Changelog

MES Agent Hub의 주요 변경. 스프린트(architecture §9) 단위로 기록한다.

## [Unreleased]

### S4 (진행 중)

- ③ 체크리스트·노트·완료 절차(2026-10-02): 체크리스트(템플릿 복사·토글·추가·삭제), AI 달성도 m/n(보조 호출)·판단대로 체크, 노트(자료함 파일 첨부), 완료 절차(리포트 미리보기·입력 출처·피드백 → 리포트 산출물 파일·상태 전이 한 트랜잭션), 활동 이력

- ② SR(2026-10-01): 접수 대화 → 접수 전환(`SR-YYYY-NNNN`·태그·AI 제목) → 제목 권한 → 담당자 연결 업무(이어가기 우선, 서버 기록 `task.sr_id`, 마이그레이션 0002) → 상태 → 결과 공유. 요청자(BO) 범위 서버 강제(목록·스레드·파일), 이벤트 채널 수신자별 필터, 알림 서버 기록(벨은 ④)

- 대조 검증 수정(2026-10-01, `fix/s3-audit`): 새 대화 첫 입력이 AI 요청으로 감(기본 모드 AI, 멱등 키 보존·재접속, 첨부 실패 시 대화 유지), 요청 크기를 실제 전송 본문 기준으로 계산(추정=기록=한도), 말풍선 첨부 표시, 요청 기록 JSON에 첨부 정보, 공유 자료함 정렬, 전송 기록에 참조 대화 모드·메시지 수, E2E 깊이 복원

- ① 관리·설정·권한(2026-10-01): 에이전트 관리 API·화면(SO 서버 강제, revision 충돌, 삭제 보호, 이미지), 전역 설정(기본 모델·파일 전달·요청 한도·SR 접수 에이전트·링크1 규칙), 코드 관리(그룹은 시스템 정의), SO·BO·활성 지정, 본인 비밀번호 변경·임시 비밀번호·변경 강제(마이그레이션 0001). 사용자 목록은 `/api/catalog/users`로 이동, `/api/users`는 SO 계정 관리용

### S3 — 참조 대화·요청 서비스·추정·실시간 (2026-10-01, `s3-done`)

- 요청 서비스: `chat_request` 상태 기계, 대화당 진행 중 1건, SSE 스트리밍, 중지·재시도, 시간 제한·생존 신호·정리, `Idempotency-Key`, OpenWebUI 파일 전달, 요청 기록 조회, 대화 소프트 삭제
- 참조 대화: 직접 태그 공유 후보, 선택 3모드(전체·메시지·요약), 스냅샷 고정·갱신, 요약 초안(보조 호출), 삭제 보호, 새 대화의 참조 지정. 메시지 순서는 서버 순번 기준
- 추정·트레이: `POST …/requests/estimate`(전송과 같은 조립 함수), 한도 초과 시 전송 차단과 조절 안내(자동 절단 없음)
- 실시간: `GET /api/events` SSE(커서·재전송 버퍼·resync·하트비트·배압 처리), 다른 PC 진행 표시, "입력 중" 표시. 폴링 제거
- E2E: requests(S5–S8)·requests-live(E2)·context(E3a–d)·tray(E4·E6·실시간). codex-critic 리뷰 3회(20건) 반영

### DB 엔진 전환 — PostgreSQL → MariaDB (2026-10-01, D40, `db-mariadb-done`)

- DB를 MariaDB 단독 설치로 전환(기준 11.8 LTS, 호환 하한 10.4). 드라이버 `mysql2`, 초기 마이그레이션 1개로 재시작(옮길 운영 데이터 없음)
- 연결마다 세션 고정(UTC·READ COMMITTED·엄격 모드), DB 정렬 `utf8mb4_nopad_bin`(대소문자·끝 공백 구분) — 다르면 `db:migrate`가 거부
- 조건부 유일성(대화당 진행 중 요청 1건, 삭제되지 않은 파일 버전)은 저장형 생성 컬럼 + 유일 인덱스. 이름 잠금은 `db_lock` 행 또는 기존 행 잠금
- 요청 lease 만료 시각을 DB 시각으로 통일(앱·DB 시계 차이의 영향 제거)
- 태그·멱등 키·SSO 식별자 길이 초과는 400. 교차 대화 파일 선택의 교착 경로 제거(업무 행 ID 오름차순 잠금)
- 테스트: 연결 계약·제약 동작·파일 버전 체인 동시성·교차 선택 동시성 추가(DB 통합 66 → 85). CI `db` 잡은 MariaDB 11.8·10.4 두 버전
- 개발 환경·설치 가이드·`DATABASE_URL`(`mysql://…`) 변경 — 기존 개발 환경은 `pnpm setup:env`를 다시 맞추고 `docker compose up -d --wait` → `pnpm db:migrate` → `pnpm db:seed`

### S2 — 카탈로그·대화·파일 (2026-09-28, `s2-done`)

- 코드 관리 1차(D36): `code_group`·`code`, assistant 1·2단계 코드 참조(마이그레이션 0002). BO 역할 `app_user.is_business_owner`(D37)
- 개발 시드 `pnpm db:seed`(가상 카탈로그 12개, 운영 거부)
- 카탈로그 API `GET /api/assistants`·`/assistants/stats`·`/users`·`/codes`, 허브 카드 뷰(검색·Lv1/Lv2 필터·중단 보기)
- 대화 API `/api/tasks`(지연 생성 + `firstMessage` 원자 저장, `WK-YYYY-NNNN` 서버 발급, 상태 전이·재개 사유, 완료 잠금 트랜잭션), 태그·자동완성, 팀 의견 메시지, 활동 이력. 초안/대화 화면, 칸반(URL 필터), RelatedStrip, ModelPicker, ActivityPanel
- 파일 API `/api/files`(업로드 한도·버전 체인·스트리밍 다운로드·산출물·소프트 삭제 참조 보호), 입력 선택 ☑/★·버전 전환(자동 교체 없음), 직접 태그 공유 후보. 자료함·미리보기·버전·컴포저 첨부·산출물 저장
- E2E: home·tasks·files(데모 E1 S1·S3·S4). codex-critic 리뷰 3회(16건) 반영

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
