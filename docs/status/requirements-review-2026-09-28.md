# 요구사항 ↔ 계획 ↔ 진행 검토 (2026-09-28)

작성: Orchestrator(Fable 5.1). 원천 문서는 요약하지 않고 경로로 가리킨다 — [PRD](../next-project/PRD.md) · [architecture](../next-project/architecture.md) · [parity-matrix](../next-project/parity-matrix.md) · [HANDOFF](../HANDOFF.md) · [KNOWN_ISSUES](../../KNOWN_ISSUES.md). 이 문서는 **검토 시점의 스냅샷**이며, 상태의 정본은 HANDOFF §6과 parity-matrix다.

## 0. 결론 한 줄

요구사항은 세 층(PRD 기능·비기능 / 결정 D1–D35 / 데모 대응표 126행)으로 정리돼 있고 스프린트 S0–S5에 빠짐없이 배정돼 있다. 진행은 **S0 완료(병합 대기) · S1 ① 완료(리뷰 반영 중) · 나머지 미착수 = 대응표 ✅25 / ⬜101**. 계획을 흔드는 간극은 세 가지 — ① 실제 사내 OpenWebUI를 이 환경에서 못 본다(파일 API·응답 형식 가정), ② SSO 미연계로 바뀐 뒤 문서 곳곳에 옛 전제가 남아 있다, ③ 코드 관리(FR-63)·BO 역할 저장은 설계가 아직 없다. 셋 다 S2 착수 전에 정리할 수 있다(§4).

## 1. 요구사항 원천과 목록

### 1.1 PRD 기능 요구사항 (FR) — 스프린트 배정과 상태

| 영역 | FR | 스프린트 | 상태 | 비고 |
|---|---|---|---|---|
| 대화·태그 | FR-01 대화=업무=스레드, 상태·완료·재개 | S2(생성·상태) · S4(리포트 저장) | ⬜ | DDL `task.status` 4값 확정 |
| | FR-02 태그 정규화·SR 코드·서버 발급 업무 코드 | S2 | ⬜ | |
| | FR-03 AI 제목·수동 제목 보호 | S3 | ⬜ | `title.ts` S0 이식 완료(코드만) |
| | FR-04 다인 참여·발화자 전달·팀 의견·PC 간 실시간(SSE) | S2·S3 | ⬜ | presence는 U5(a) SSE로 |
| 자료 | FR-10 보관≠전송, 입력 고정 | S2 | ⬜ | domain 규칙 S0 이식 완료 |
| | FR-11 파일 버전 | S2 | ⬜ | |
| | FR-12 공유 자료함(직접 태그) | S2 | ⬜ | |
| | FR-13 산출물 저장 | S3 | ⬜ | |
| | FR-14 파일은 디스크·NAS, DB는 메타 | **S1 ②**(FileStorageService) → S2 | ⬜ | 명세 초안 tasks/s1-llm-proxy |
| | FR-15 미리보기·다운로드·버전 비교 | S2 | ⬜ | |
| 참조 대화 | FR-20~23 | S3 | ⬜ | `context.ts`·`promptBuilder.ts` S0 이식 완료, E2·E3 회귀 기준 |
| AI 요청 | FR-30 트레이=실제 전송 같은 계산 | S3(추정 API) | ⬜ | `buildChatRequest dryRun` 이식 완료 |
| | FR-31 자동 절단·요약 금지, 한도 초과 차단 | S3 | ⬜ | |
| | FR-32 OpenWebUI 파일 첨부(서버 대리) | S1 ②(기반) · S3(실행) | ⬜ | **실환경 미확인(D31) — 최대 기술 위험** |
| | FR-33 요청 1건·스트리밍·중지·시간 제한·정리 | S3 | ⬜ | RequestService |
| | FR-34 답변별 요청 기록·JSON 다운로드 | S3 | ⬜ | |
| | FR-35 모델 결정 3단계 | S1 ②(목록 U6) · S2·S4 | ⬜ | |
| | FR-36 업무 절차 프롬프트 금지 | 전 스프린트 원칙 | ✅(원칙) | promptBuilder 이식으로 유지 |
| 체크리스트·노트 | FR-40·41 | S4 | ⬜ | |
| SR | FR-50·51 | S4 | ⬜ | BO 공개 범위 서버 강제 — KI-2(역할 저장) 선결 |
| 관리·설정 | FR-60 에이전트 관리 SO 전용 | S4 | ⬜ | D19 |
| | FR-61 전역 설정 SO 전용, 키는 서버 | S1 ②(키 서버) · S4(화면) | ⬜ | U8(a)·U9(a) |
| | FR-62 리포트 | S4 | ⬜ | |
| | **FR-63 코드 관리** (신규 D35) | S4(설계·구현) | ⬜ | **DDL·화면 없음 — 설계 필요(§4 G3)** |
| 인증 | (PRD §2) 로그인·역할 서버 강제 | S0(OIDC) · **S1 ①(local)** · S4(역할 지정 화면) | 🟡 | S1 ① 구현 완료, 리뷰 반영 중 |

### 1.2 비기능 (PRD §6) — **전부 제안값, 미확정**

동시 사용자 50/스트림 20 · 파일 50 MB/요청 20개 · 소프트 삭제·1년 정리 · 이력 추가만 · 보안(SSO→이번 페이즈 앱 로그인, 서버 권한, 키 서버, 경로 서버 생성) · 업무 시간 운영 · Edge/Chrome 1280+375 · 조회 1초. 사용자 회신 대기 항목(HANDOFF §6 "착수 전 확인"). S5 비기능 점검 전, 늦어도 S3(요청 크기 한도·시간 제한 상수) 전에 확정이 필요하다.

### 1.3 결정 로그 (HANDOFF §5 D1–D35) — 계획에 영향을 준 최근 결정

| 결정 | 계획 영향 |
|---|---|
| D22 크로스플랫폼(Windows 최종) | 네이티브 패키지 회피(D34 scrypt), CI ubuntu+windows, 배포 방식 S5 |
| D28 대응표 U1–U9 모두 (a) | 데모 100% 수용, U7만 대체. S1(U6·U8)·S2(U2·U3·U4)·S3(U5)·S4(U1·U9)·S5(U7) |
| D29 merge commit(--no-ff)·한국어 커밋 | git-policy |
| D30 오케스트레이터=계획·검증, 구현=워커 | 태스크마다 brief·write_scope 승인·scope_check·[VERIFICATION] |
| **D31 사내 OpenWebUI는 사내에서만** | S1 원안(실환경 확인) → 킵. S1 ② = 프리셋 전환 가능한 서버 대리 호출 기반. FR-32 파일 API는 사내 확인 때까지 가정 |
| **D32 Windows 서버 + PostgreSQL, SSO 미연계** | D21 대체. architecture §5·PRD §2·§7의 "SSO" 문구는 후속 페이즈로 재기술 필요(§4 G2) |
| D33 SO·BO·기본 사용자 | `requester` = BO. 저장 방식 미정(KI-2) |
| D34 앱 자체 로그인, ID=계정, 단순 가입 | S1 ① 구현 완료. 최초 SO 부여는 리뷰 반영으로 "부트스트랩 한정"으로 강화 중 |
| D35 코드 관리 | FR-63 신설. assistant `level1`·`level2`는 현재 DDL에 자유 텍스트 → 코드 테이블 설계 필요 |

### 1.4 세션 지시(문서 밖 요구) — 반영 위치

- 매 보고에 대응표 잔여 수 → CLAUDE.md 작업 방식 ✅
- 저장소 public 유지(회사 PC에서 받아야 함, GitHub 로그인 불가) → git-policy §7 ✅, 수신 방법 조사는 미완(§4 G7)
- 봇 ID 등 환경 고유값은 `CLAUDE.local.md` → ✅(이력 재작성 완료)
- OpenAI 등 다른 API로 전환 가능하게 → S1 ② 명세 `LLM_PRESET` ✅(초안)

### 1.5 데모 대응표 (parity-matrix, 126행)

✅ 26 (S0: 라우트 셸·domain 61테스트·llm 41테스트·앱 셸·로그인/회원가입) / ⬜ 101. 잔여 분포(표별 열 구조를 맞춰 집계): **S2 34 · S4 33 · S3 22 · S2·S3 겹침 3 · S2·S4 2 · S2–S4 1 · S1 1 · S5 1 · 기타 4**(셸→S2 1, §8 설정 항목 3 — S1/S4). U1–U9 "결정 필요" 표기는 0으로 정리됐다.

## 2. 스프린트 계획과 요구사항 연결 (architecture §9 기준, D31·D34로 S1 재정의)

| 스프린트 | 내용 | 연결 요구사항 | 완료 기준 | 상태 |
|---|---|---|---|---|
| S0 | 모노레포·CI·compose·Drizzle·로그인 골격 | 스택 D20·D22, PRD §2 | 로그인 → 빈 허브, typecheck·test·lint | **완료**(macOS 전부 녹색). 병합 대기: CI windows 잡 통과, `setup-guide` 잡은 psql 연결에서 멈춤(진단 중) |
| S1 ① | 앱 자체 로그인·회원가입 | D32·D34, PRD §2 | 단위·DB·E2E·CI | **구현 완료**(단위 137·DB 7·E2E 2). codex-critic 5건 중 4건 반영 중 |
| S1 ② | 서버 LLM 설정·프리셋(openwebui/openai-compatible)·모델 목록·`LlmPorts` DB 어댑터·`FileStorageService` | D31, U6·U8, FR-14·35·61 | 가짜 OpenWebUI 계약 테스트 + `.env`만 바꿔 OpenAI로 목록 | 명세 초안 작성, ① 병합 후 착수 |
| S2 | 에이전트·대화·태그·파일·입력 선택 API, 웹 저장소 함수 → API | FR-01·02·04·10~12·15·20(후보), U2·U3·U4 | 데모 E1 S1–S5 통과 | 미착수(⬜ 30+) |
| S3 | 참조 대화·RequestService·추정 API·SSE | FR-03·13·20~23·30~34, U5 | 데모 E2–E5 통과 | 미착수(⬜ 11+) |
| S4 | SR·체크리스트·노트·알림·리포트·설정·권한 전체·**코드 관리**·SO/BO 지정 | FR-40·41·50·51·60~63, U1·U9, KI-2 | 역할별 E2E | 미착수(⬜ 32) — 설계 선결: FR-63, BO 저장 |
| S5 | 비기능·배포(Windows 서비스)·이관 도구(U7) | PRD §6, D22·D32 | 운영 준비 | 미착수 — 비기능 확정 대기 |

## 3. 진행 상황 요약 (2026-09-28 08:30)

- 원격: `main`(초기 커밋) · `feat/s0-skeleton` · `feat/s1-auth-local` push 완료. S0 CI: `setup-guide` 잡이 `psql -U postgres -h localhost`에서 33분 정지 → 진단(Windows 러너의 action-setup-postgres가 PG* 환경을 덮어써 `PGPASSWORD`가 비고 psql이 비밀번호 프롬프트 대기) → 스텝 env 재지정(`bbaccf8`) → **재실행 5개 잡 전부 녹색**(run 36358525856). KI-4 해소. `main` 병합은 사용자 승인 대기.
- `feat/s1-auth-local`: feat(auth)·docs 커밋 2개. 리뷰 반영(F1 최초 SO 부트스트랩 한정, F2 로그인 CSRF Origin 검사, F3 중복 ID 해시 전 조회, F4 실패 경로 타이밍 균일화, F5 AuthGate 모드 조회 오류 화면)을 codex-main이 수행 중.
- 미회신: OpenWebUI 버전, 비기능 제안값, 회사 망에서 github.com 접근 여부.

## 4. 검토 — 간극·위험·모순

| # | 내용 | 영향 | 제안 |
|---|---|---|---|
| **G1** | **실제 OpenWebUI 미확인**(D31). FR-32 파일 API(업로드→처리 확인→`files` 파라미터)와 응답 형식은 데모 시점 가정. 사내 버전도 미회신 | S3 RequestService의 파일 전달·실패 처리(D17)가 가정 위에 서게 됨. 틀리면 S3 재작업 | S1 ②에서 어댑터 경계(`LLM_PRESET`)를 분명히 두고, **사내에서 real-env-verification C1–C9를 한 번 수행**한 결과를 S3 착수 전에 받는다. 그때까지 가짜 OpenWebUI를 데모가 본 형태로 유지 |
| **G2** | **SSO 문구 잔존**: architecture §5·표 "인증=SSO", PRD §2 "로그인은 사내 SSO", PRD §7 범위 "SSO 로그인" 포함, D21. 실제는 D32·D34(앱 로그인, SSO는 후속) | 새로 읽는 사람이 계획을 오해. 정본 충돌은 "번호 큰 결정 우선"으로 해소되지만 문서가 따라가야 함 | architecture §5 머리에 "이번 페이즈는 `AUTH_MODE=local`(D34), SSO 연계는 후속" 추가, PRD §7 범위에서 SSO를 후속으로 이동, D21에 "D32·D34로 대체" 표기 (docs 커밋 1건) |
| **G3** | **FR-63 코드 관리 설계 없음**. DDL의 `assistant.level1/level2`·각종 `status` check 제약은 하드코딩. 사용자는 "관리가 필요한 병렬 단계·상태는 코드로" | S2에서 에이전트 API를 만들 때 level1/level2를 자유 텍스트로 굳히면 S4에서 마이그레이션 | **S2 착수 전** 최소 설계 결정: 코드 그룹 테이블(`code_group`·`code`) + assistant.level1/level2를 코드 참조로. 사용자와 "코드로 관리할 대상 목록"을 먼저 합의(사용자도 "구체는 구현 때 논의"라 함) |
| **G4** | **BO(요청자) 역할 저장 없음**(KI-2). `app_user.role`은 표시용 직책 문자열, `is_system_owner`만 권한 | FR-51 요청자 공개 범위 서버 강제(S4)와 SR 접수 화면 권한 불가 | G3와 함께: `app_user.role_code`(코드 테이블 참조: member/system_owner/business_owner) 또는 `is_business_owner` 불리언. S4 전 DDL 결정 |
| **G5** | **Windows 실기 미확인**. CI `setup-guide` 잡 정지는 원인 규명·수정 후 녹색(KI-4 해소) | S0 완료 기준 중 "사람이 Windows PC에서 문서대로 로그인"만 남음 | 사용자 Windows PC에서 1회 확인(문서 명령은 CI가 대신 검증). S1 ① 병합 뒤 앱 로그인으로 한 번에 |
| **G6** | 비기능 제안값 미확정 | S3 상수(요청 한도·시간 제한)·S5 | PRD §6 표를 그대로 승인/수정 회신 요청 |
| **G7** | 회사 PC에서 저장소 수신 방법 미정(public 유지 사유) | 배포 절차(S5) | 회사 망에서 `git clone https://github.com/BiohPark/mes-assistant-platform3` 1회 시험 → 결과에 따라 PAT/deploy key/zip 중 선택 |
| **G8** | 회원가입 공개(KI-5): 횟수 제한·비밀번호 변경·재설정 없음 | 사내망 전제라 낮음 | S4 계정 관리 화면과 함께. 리버스 프록시 제한은 S5 |
| **G9** | U7 데모 데이터 이관 도구(S5 선택) — 실데이터 이관 필요 여부 미정 | S5 범위 | 데모에 실업무 데이터가 있는지 사용자 확인 |
| ~~G10~~ | (철회) 대응표 19행이 스프린트 미기재로 보였던 것은 §9 E2E 표가 4열이라 집계 스크립트가 열을 잘못 읽은 것. 실제로는 모두 스프린트가 있다 | — | 집계는 표별 열 구조로 다시 계산(§1.5) |

모순 점검: 원칙(HANDOFF §2) 위반은 없다. D6(직접 태그만)·D15(자동 절단·요약 금지)·FR-36은 이식된 domain·llm 테스트가 지킨다. D24(최초 SO 부여만)는 리뷰 F1로 "부트스트랩 1회"로 좁혀지며 D24와 충돌하지 않는다(부여만·해제 없음 유지).

## 5. 권고 순서

1. S0 마감: psql 진단 → 수정 → CI 녹색 → `main` 병합(--no-ff)·`s0-done`. (사용자 승인)
2. S1 ① CI 녹색 확인 → `main` 병합. 문서 정합(G2)은 반영 완료(`7f5bc2d`).
3. S1 ② 착수(명세 확정). 병행: 사용자 회신 — 비기능(G6)·OpenWebUI 버전·회사 망 clone 시험(G7)·코드 관리 대상 목록(G3)·BO 저장(G4).
4. S2 착수 전 G3·G4 DDL 결정 반영(마이그레이션 1건).
5. S3 착수 전 사내 real-env-verification 결과 수령(G1).

## 6. 문서 정합 갱신 목록 (이 검토로 생긴 할 일)

- ~~architecture.md §5·표(인증) · PRD §2·§7 · D21 표기 → D32·D34 반영 (G2)~~ 완료 `7f5bc2d`
- PRD FR-63·KI-2 → S4 설계 메모(G3·G4) — 결정 후
