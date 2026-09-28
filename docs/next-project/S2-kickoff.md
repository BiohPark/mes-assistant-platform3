# S2 착수 계획 (초안 — 사용자 승인 전)

> 작성 2026-09-28, Orchestrator. S1 두 태스크가 CI 녹색·병합 대기인 시점의 계획. **G3(코드 관리)·G4(BO 역할) 결정과 이 계획의 승인이 있어야 착수한다.** 정본은 [PRD](PRD.md)·[architecture §9](architecture.md)·[parity-matrix](parity-matrix.md)·[data-contract §6](../architecture/data-contract.md)·[openapi.yaml](openapi.yaml)이며, 이 문서는 그것을 태스크로 쪼갠 것이다.

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
| ④ | `s2-e2e` 회귀 | — | — | 데모 `e2e/context-flow.spec.ts` **S1·S3·S4** 이식(로그인 단계 추가, 가짜 OpenWebUI는 compose) + `support/app.ts` | §9 S1·S3·S4 |

순서 ① → ② → ③ → ④. ②·③은 API 계약(contracts zod)이 먼저 정해지면 병렬 가능하지만 같은 작업 트리를 쓰므로 **순차**로 한다.

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

- ①: `apps/api/**, apps/web/**, packages/**, docs/architecture/postgres-draft.sql, .env.example`
- ②·③: `apps/api/**, apps/web/**, packages/**, docs/architecture/postgres-draft.sql`
- ④: `e2e/**, docker/**, apps/web/**`(테스트용 data-testid 추가에 한정)
- codex-critic: `none`

## 위험

- **G1(실제 OpenWebUI 미확인)**은 S2엔 영향 없음(파일 업로드는 우리 서버). S3 전에 사내 확인 필요.
- 데모 `features/task`(2,067줄)·`chat`(1,172줄) 이식 규모가 크다 — ②·③은 각각 워커 1회에 안 끝날 수 있어 2단계로 쪼갤 수 있음(brief 재승인 없이 같은 write_scope).
- 데모 저장소 함수와 API 클라이언트의 시그니처를 맞추는 원칙(architecture §3) 때문에 웹 코드 변경은 최소여야 한다 — 워커 brief에 "화면 코드는 가져오고, `db.*` 호출만 API 클라이언트로" 명시.
