# S2 착수 계획 (2026-09-28 사용자 승인 — 세부 결정 S2-1~S2-10 모두 추천안)

> 작성 2026-09-28, Orchestrator. 사용자 승인: 계획·세부 결정 10건 모두 추천안(디스코드, 2026-09-28). G3=S2-1(a), G4=S2-2(a). 정본은 [PRD](PRD.md)·[architecture §9](architecture.md)·[parity-matrix](parity-matrix.md)·[data-contract §6](../architecture/data-contract.md)·[openapi.yaml](openapi.yaml)이며, 이 문서는 그것을 태스크로 쪼갠 것이다.

## 목표 (architecture §9 S2)

에이전트·대화·태그·파일·입력 선택 **API**를 만들고, 웹의 데모 저장소 함수(`src/db/repositories/*`)를 **같은 이름·인자의 API 클라이언트**로 바꿔 허브(카드·칸반) → 새 대화(지연 생성) → 대화 화면(자료함·파일·입력 선택·팀 의견)까지 동작하게 한다. **완료 기준: 데모 E1 시나리오 중 S2 배정분(S1·S3·S4) 통과** + 단위·DB·E2E·CI 녹색.

> architecture §9는 "S2: 데모 E1 S1–S5"라 적었지만 parity-matrix §9가 더 세밀하다 — E1 **S2(SR 접수 첨부)는 S4**, **S5(OpenWebUI 첨부 처리)는 S3**(RequestService). S2 완료 기준은 parity 기준(S1·S3·S4)으로 한다. architecture §9 문구는 착수 시 정리.

## 범위 밖 (S3·S4로)

AI 요청 실행·스트리밍·중지·추정(S3, RequestService·SSE·presence U5) · 참조 대화 선택(S3) · SR·체크리스트·노트·알림·리포트·설정 화면·SO 관리 화면·코드 관리 화면(S4). S2의 대화 화면은 **팀 의견(AI 미전송) 메시지**까지만 — AI 전송 버튼은 S3에서 켠다.

## 태스크 분할 (각각 codex-main 구현 + codex-critic 리뷰, write_scope 좁힘)

| # | 태스크 | 서버 | 웹 | 이식 테스트 먼저 | 대응표 |
|---|---|---|---|---|---|
| ① | `s2-catalog` 에이전트·사용자·코드 | `GET /api/assistants`(전체) · `GET /api/users` · **G3 결정 반영**: `code_group`·`code` 테이블 + assistant `level1/level2` 코드 참조(마이그레이션) · 개발용 시드 `pnpm db:seed`(가상 카탈로그, D13) · `GET /api/assistants/stats`(카드별 대화 집계) | `hooks.ts`(사용자·설정 훅 → TanStack Query) · `HomePage` 카드↔칸반 토글 · `AssistantCard` · `CardMapFilterBar`(U4) · `useAssistantStats` · `uiStore`·`useMediaQuery` · 공용 컴포넌트(`AssistantAvatar` `TagChip` `TagInput` `StatusBadges` `Markdown` `ConfirmDialog` `ReasonDialog`, `lib/labels·activity·clipboard·ids`) | `assistants.test.ts`(읽기 부분) | 라우트 `/` 카드, §2 hooks·uiStore·useMediaQuery, §3 home 6행, §7 공용 |
| ② | `s2-tasks` 대화·태그·활동 | `POST /api/tasks`(지연 생성: 첫 전송·첨부 때, 업무 코드 서버 발급 FR-02) · `PATCH /api/tasks/{id}` · `POST …/status`(완료·재개 사유, 참조 보호는 S3) · `DELETE`(409 사유) · `POST/DELETE …/tags/{tag}`(정규화·SR 코드) · `GET /api/tasks`(칸반·필터) · `GET /api/tasks/{id}` · 스레드·메시지: `POST /api/threads/{id}/messages`(팀 의견만) · 활동 이력 `activity`(추가만) · 태그 자동완성 `GET /api/tags/suggest` | 라우트 `/new/:assistantId`(`DraftConversationPage`, `?tag=`·`?ref=`, 추천 칩 U2) · `/c/:taskId`·`/tasks/:taskId` 리다이렉트 · `TaskPage`(초안 첫 메시지 인계) · `TaskHeader` · `RelatedStrip`(U3) · `TaskBody` 골격 · `ConversationKanban`·`ConversationCard` · `useTagSuggest` · `ChatView`(팀 의견 표시만)·`Composer`(텍스트 + 첨부 훅은 ③) · `ModelPicker`(S1 ② `useModelList`) | `conversations.test.ts` · `tasks.ts`의 규칙(domain 이식분 재사용) | 라우트 3행, §3 task 5행·conversation, §4 chat 일부, §5 tasks·chat·activity |
| ③ | `s2-files` 파일·입력 선택·후보 | `POST /api/files`(multipart, `FileStorageService`, sha256, 버전 체인 FR-11) · `GET /api/files/{id}/content`(권한: 로그인 사용자, S4에서 BO 범위) · `PATCH`(산출물 표시 `setOutputTag`) · `DELETE`(소프트) · `GET …/versions` · `POST /api/tasks/{id}/outputs`(답변→산출물, 기본 이름 규칙 FR-13) · `PUT/DELETE /api/tasks/{id}/inputs/{fileId}`(☑/★) · `…/switch-version` · `GET /api/tasks/{id}/candidates`(**직접 태그 공유** 파일만 — 대화 후보는 S3) · 비기능 한도(파일 50 MB — PRD §6 미확정이면 설정값) | `MaterialsPanel`(AI 입력·공유 자료함·이 대화 파일; SR 첨부 탭은 S4) · `FileList` · `FilePreviewDialog` · `FileVersionsDialog` · `InputToggle` · `Composer` 첨부(기본 고정·"이번 메시지만") · `SaveAsOutputDialog` | `files.test.ts` · domain `tags`·`conversationContext`(입력 규칙) | §3 task 5행, §4 Composer·SaveAsOutput, §5 files |
| ④ | `s2-e2e` 회귀 | — | — | 데모 `e2e/context-flow.spec.ts` **S1·S3·S4** 이식(로그인 단계 추가, 가짜 OpenWebUI는 compose) + `support/app.ts` — **③에 흡수**(`e2e/tests/files.spec.ts`로 작성·CI 통과, 별도 태스크 폴더 없음) | §9 S1·S3·S4 |

순서 ① → ② → ③ → ④. ②·③은 API 계약(contracts zod)이 먼저 정해지면 병렬 가능하지만 같은 작업 트리를 쓰므로 **순차**로 한다.

## 세부 결정 — 선택지 비교와 추천 (2026-09-28 사용자: "모두 추천안으로 진행")

| # | 결정 | 선택지 | 비교 | **추천** |
|---|---|---|---|---|
| S2-1 | **코드 관리 1차 설계(G3, FR-63)** | (a) 공통 코드 테이블 `code_group`·`code` + assistant `level1/level2`만 코드 참조, 로직 상태(task·SR·요청 status)는 check 제약 유지 · (b) 로직 상태까지 전부 코드 테이블 · (c) S4로 미룸 | (a) 마이그레이션 1회·S2 비용 작음(테이블 2개+참조 2컬럼), S4 관리 화면이 붙일 자리 확보. (b) 전이 규칙(domain 61테스트)이 값에 묶여 있어 데이터로 바꾸면 규칙·테스트 동시 개정 — S3·S4 재작업 위험, 얻는 유연성은 "상태 이름 바꾸기" 정도. (c) S2에서 자유 텍스트로 굳으면 S4에 데이터 마이그레이션(값→코드) 1회 추가 | **(a)**. 표시 이름 변경 요구가 오면 `code`에 label만 매핑하는 절충으로 (b)의 이점을 흡수 |
| S2-2 | **BO 역할 저장(G4, KI-2)** | (a) `is_business_owner boolean` · (b) `role_code` 단일 컬럼(코드 참조) · (c) `user_role` 다대다 | (a) SO와 같은 패턴, 가드 1줄, SO∧BO 조합 가능. (b) G3와 일관되지만 조합 불가(SO이면서 BO인 사람 처리 못 함). (c) 유연하나 지금 역할 3개에 과함 | **(a)**. 역할이 4개 이상으로 늘면 (c)로 승격 |
| S2-3 | **S2 완료 기준 범위** | (a) 데모 E1 **S1·S3·S4**(parity 배정) · (b) architecture §9 원문 S1–S5 | (b)의 S2(SR 접수 첨부)는 SR 화면(S4), S5(OpenWebUI 첨부 처리 확인)는 RequestService(S3)가 있어야 돌아감 — S2에 넣으면 S3·S4 일부를 끌어와야 함 | **(a)**. architecture §9 문구를 parity에 맞게 정리 |
| S2-4 | **태스크 분할·순서** | (a) 4개 순차(catalog→tasks→files→e2e) · (b) 2개(서버 전부 → 웹 전부) · (c) 화면 단위 세분(6개+) | (a) 태스크마다 서버+웹+테스트가 닫혀 검증·리뷰 단위가 명확, write_scope 좁힘 가능. (b) 서버만 끝나면 검증할 화면이 없어 E2E 불가, 리뷰 덩어리 큼. (c) 승인·brief·리뷰 오버헤드 증가, 화면 간 공용 코드 중복 위험 | **(a)**. ②·③이 워커 1회를 넘으면 같은 write_scope 안에서 2단계로 나눔(재승인 불필요) |
| S2-5 | **PC 간 실시간 반영(FR-04) 시점** | (a) S3에서 SSE(`/api/events`)로 한 번에 · (b) S2부터 폴링(주기 refetch) · (c) S2부터 SSE | (a) architecture 배정, S3 RequestService 스트리밍과 같은 채널 설계 1회. (b) 임시 코드가 S3에서 버려짐. (c) S2 범위 팽창 | **(a)**. S2는 변경 직후 TanStack Query 무효화(같은 브라우저)만 |
| S2-6 | **파일 한도 기본값(PRD §6 미확정)** | (a) 설정값 `FILE_MAX_BYTES`=50 MB·`FILE_MAX_PER_REQUEST`=20으로 진행 · (b) 비기능 확정까지 대기 | (a) 확정이 늦어도 S2를 막지 않고, 값은 `.env`로 바꿈. (b) S2 지연 | **(a)**. PRD §6 회신 오면 기본값만 갱신 |
| S2-7 | **업무 코드 형식(FR-02 서버 발급)** | (a) 데모 그대로 `WK-YYYY-NNNN`(SR은 `SR-YYYY-NNNN`), 서버가 연도별 시퀀스로 발급 · (b) 새 형식 | (a) 데모 태그 정규식·테스트(`SR-\d{4}-\d{4}`)와 호환, 이관 도구(U7)도 단순. (b) 이유 없음 | **(a)**. 동시 생성 충돌은 DB 시퀀스/advisory lock으로 |
| S2-8 | **개발용 시드** | (a) `pnpm db:seed` — 가상 에이전트 카탈로그·가상 사용자(D13), 개발·E2E 전용 · (b) 시드 없음(SO가 화면에서 등록) | (a) E2E(카드·칸반·대화 생성)가 에이전트 없이는 성립 안 함, 매 실행 재현 가능. (b) 에이전트 관리 화면은 S4라 S2에서는 데이터 넣을 방법이 없음 | **(a)**. 시드는 idempotent(있으면 건너뜀), 운영 DB엔 실행 금지 가드(`NODE_ENV=production` 거부) |
| S2-9 | **S2의 파일 내용 접근 권한** | (a) 로그인 사용자 전원(PRD §2 "모든 담당자가 모든 대화를 볼 수 있음") · (b) 대화 참여자만 | (a) PRD와 일치, 구현 단순. (b) PRD 범위 밖(부서·참여 범위는 후속). BO 제한(FR-51)은 S4에서 별도 | **(a)**. S4에서 BO는 공유 결과만 |
| S2-10 | **가짜 OpenWebUI 사용 방식(S2 E2E)** | (a) compose 서비스 유지, S2 E2E는 LLM 호출 없음(팀 의견만) · (b) 데모의 브라우저 내 가짜(`support/fakeOpenWebUI.ts`) 이식 | (a) S2에는 AI 전송이 없어 가짜 서버가 필요 없음, S3에서 compose 서비스로 S5 시나리오. (b) 서버가 대리 호출하는 구조에서 브라우저 가짜는 의미 없음 | **(a)**. 데모 `support/fakeOpenWebUI.ts`는 이식 제외(대응표 §9 지원 파일 행 갱신) |

승인 형식 예: "S2-1 a, S2-2 a, … 전부 추천대로" 또는 바꿀 항목만 표기.

## 결정 반영 지점

- **G3 코드 관리**: ①에서 DDL(코드 테이블·assistant 참조). (a)면 `code_group`·`code` + 시드에 SDLC/Record·분석/Deviation/CC… 코드 포함. 관리 화면은 S4.
- **G4 BO 역할**: ①의 사용자 API·DDL(`is_business_owner` 또는 `role_code`). 가드 `@Roles('requester')`는 S4 SR에서 사용.
- **D6·D15**: ③ 후보는 직접 태그 공유만, 자동 교체 없음(새 버전은 안내만). 서버가 강제.
- **D13**: 시드는 가상 카탈로그·가상 사용자만.
- **비기능(PRD §6)**: 파일 크기·첨부 개수 한도는 설정값(`FILE_MAX_BYTES` 등)으로 두고 제안값을 기본으로 — 미확정 상태를 막지 않는다.

## 완료 기준 (Verification)

1. ①–③ 각: 이식 테스트 먼저 통과 → 단위·DB 테스트 → typecheck·lint 0 → CI(ubuntu+windows) 녹색 → codex-critic 리뷰 반영
2. ④: E1 S1·S3·S4 통과(로컬 + CI E2E 잡)
3. 대응표 S2 배정 34행 중 이번 범위 행 ✅ 갱신, 남은 수 보고
4. 문서: openapi.yaml(구현한 경로 정합), HANDOFF §6, setup 가이드(시드 명령 `pnpm db:seed`)

## 워커 쓰기 범위 (승인 요청값)

- ①: `apps/api/**, apps/web/**, packages/**, e2e/**, docs/architecture/postgres-draft.sql, .env.example, package.json`(루트 — `db:seed` 스크립트 1줄, E2E 시드 단계)
- ②·③: `apps/api/**, apps/web/**, packages/**, docs/architecture/postgres-draft.sql`
- ④: `e2e/**, docker/**, apps/web/**`(테스트용 data-testid 추가에 한정)
- codex-critic: `none`

## 위험

- **G1(실제 OpenWebUI 미확인)**은 S2엔 영향 없음(파일 업로드는 우리 서버). S3 전에 사내 확인 필요.
- 데모 `features/task`(2,067줄)·`chat`(1,172줄) 이식 규모가 크다 — ②·③은 각각 워커 1회에 안 끝날 수 있어 2단계로 쪼갤 수 있음(brief 재승인 없이 같은 write_scope).
- 데모 저장소 함수와 API 클라이언트의 시그니처를 맞추는 원칙(architecture §3) 때문에 웹 코드 변경은 최소여야 한다 — 워커 brief에 "화면 코드는 가져오고, `db.*` 호출만 API 클라이언트로" 명시.
