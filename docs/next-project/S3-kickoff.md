# S3 착수 계획 (초안 — 사용자 승인 전)

> 작성 2026-09-28, Orchestrator. S2 ③까지 검증 완료·병합 대기 시점의 계획. 정본은 [PRD](PRD.md) §4.3·4.4 · [architecture §9](architecture.md) · [parity-matrix](parity-matrix.md) §4·§5·§9 · [data-contract §5·§6](../architecture/data-contract.md) · [fusion-design §5](../fusion-design.md) · [evaluation/context-flow.md](../evaluation/context-flow.md) · [openapi.yaml](openapi.yaml)(`/threads/{id}/requests…`·`/requests/{id}…`·`/tasks/{id}/conversation-inputs…`·`/events`). 이 문서는 그것을 태스크로 쪼갠 것이다.

## 목표 (architecture §9 S3)

**참조 대화 · 요청 서비스(활성 1건·스트리밍·재시도·정리) · 추정 API · 이벤트 SSE.** 데모의 `chatRunner.ts`(탭 메모리)를 서버 `RequestService`로 옮기고, 참조 대화 선택·요약·갱신을 서버 저장(`conversation_input`·`context_snapshot`)으로, "보낸 것 = 본 것"(트레이 추정과 실제 전송이 같은 조립 함수)을 서버에서 강제한다. **완료 기준: 데모 E1 S5–S8 · E2 · E3a–d · E4 · E6 통과 + E5 보호 단위 테스트 이식 + 단위·DB·E2E·CI 녹색.**

## 범위 밖 (S4·S5)

SR·체크리스트·노트·알림·리포트·설정 화면·SO/BO 지정·코드 관리 화면(S4), 실제 사내 OpenWebUI 연동 확인(D31 — 사내에서), 비기능 점검·배포(S5). 시스템 assistant(U1)는 S4.

## 태스크 분할 (각각 codex-main 구현 + codex-critic 리뷰, 순차)

| # | 태스크 | 서버 | 웹 | 이식 테스트 먼저 | 대응표·회귀 |
|---|---|---|---|---|---|
| ① | `s3-request` 요청 서비스 | `RequestService`: `POST /api/threads/{id}/requests`(진행 중 1건은 부분 고유 인덱스, 완료 대화 409, 한도 초과 413) → `chat_request`·`chat_request_input` 기록 → `promptBuilder`(packages/llm, `DbLlmPorts` 완성: `loadConversationInputs`는 ②에서, 이번엔 파일·메시지) → provider 스트리밍 → 답변 메시지(`streaming→done/error`) · **SSE 응답**(`started`·`phase`·`delta`·`completed`·`failed`) · `POST …/cancel`(부분 응답 보존) · `POST /api/requests/{id}/retry`(최근 실패 답변만, `excludeFileIds`·`forceInlineFileIds`) · 시간 제한(첫 토큰 60초/파일 360초, 토큰 사이 60초 — FR-33) · **생존 신호 `lease_until`·끊긴 요청 정리 주기 작업**(자동 재전송 없음) · OpenWebUI 파일 전달(`openwebuiFiles.ts` 서버 실행: 업로드→처리 확인→`files` 파라미터, 실패 시 요청 중단 + 항목별 실패 D17, `file_remote_ref` 캐시) · 가짜 OpenWebUI에 파일 처리 상태 엔드포인트 추가 · `GET /api/requests/{id}`·`/snapshot`(키 제외) | `useChat`(SSE 소비)·`ChatView` AI 전송·중지 · `MessageBubble` 실패 복구(재시도·빼고 다시·텍스트로) · `requestLabels` · `RequestInfoDialog`(사용한 자료·전달 방식·크기·모델·원본 JSON 다운로드) | 데모 `chatRunner.test.ts` 12건 → 서버 단위(E5 보호) · `openwebuiFiles.test` 재사용 | §4 chat 6행·§5 chat 잔여 · E1 **S5·S6·S7·S8** · **E2** · E5 |
| ② | `s3-context` 참조 대화 | `GET /api/tasks/{id}/candidates`에 **대화 후보**(같은 태그 직접 공유, 최근 활동순, 원문 규모) · `PUT/DELETE /api/tasks/{id}/conversation-inputs/{sourceTaskId}`(mode full/messages/summary · weight · messageIds) · `context_snapshot` 생성(선택 시점 고정, 팀 의견·실패 응답 제외, 재귀 없음) · `POST …/refresh` · `POST …/summary-draft`(누를 때만, 확인·수정 후 적용; 원문 한도 초과 413) · 참조 중인 대화 삭제 금지(409) · `DbLlmPorts.loadConversationInputs` 완성 → promptBuilder 배치(fusion §5.5) | `ConversationInputs`·`ConversationPickerDialog`·`useTaskData` 대화 후보·원문 규모 · 자료함 "참조 대화" 영역 · `?ref=` 미리 선택(S2 보류분) | 데모 `conversationInputs.test.ts` · `conversationSummary.test`(이식 완료) | §3 task 2행·§5 conversationInputs · **E3a–d** |
| ③ | `s3-tray-events` 추정·SSE 이벤트·presence | `POST /api/threads/{id}/requests/estimate`(**실제 전송과 같은 조립 함수** `buildChatRequest({dryRun})`, 업로드 없이 첨부 예정으로 계산) · 요청 크기 한도(`request_budget_bytes` 설정값, 초과 시 전송 차단 + 줄이는 방법 안내, 자동 절단·요약 금지) · `GET /api/events`(SSE: task·message·request·file 변경 이벤트 → 웹 TanStack 무효화, PC 간 실시간 FR-04) · presence "입력 중"(U5a: SSE 휘발성) | `ContextTray`·`useRequestEstimate` · 이벤트 구독 훅(무효화) · `presence` 표시 · 칸반·대화 화면 실시간 반영 | 데모 `requestBudget.test`(이식 완료)·`context.test` | §2 presence·§4 ContextTray·useRequestEstimate · **E4** · **E6** · FR-04 실시간 |

순서 ① → ② → ③. ②는 ①의 promptBuilder 서버 실행 위에서 참조 대화 배치가 붙고, ③의 추정은 ①·②의 조립 함수를 그대로 쓴다.

## 세부 결정 — 선택지 비교와 추천 (사용자 승인 요청)

| # | 결정 | 선택지 | 비교 | **추천** |
|---|---|---|---|---|
| S3-1 | **스트리밍 전송 채널** | (a) 요청 `POST`의 응답을 SSE로(openapi 초안) + 별도 `GET /api/events`로 다른 PC·탭 갱신 · (b) 모든 스트림을 `/api/events` 하나로 · (c) WebSocket | (a) 요청한 탭은 즉시 델타, 다른 탭·PC는 이벤트로 메시지 재조회 — 단순·프록시 친화. (b) 이벤트 채널에 델타까지 실으면 구독자 전원에게 토큰이 감. (c) Windows 서비스·리버스 프록시 설정 부담 | **(a)** |
| S3-2 | **끊긴 요청 정리 주기 작업** | (a) api 프로세스 안의 setInterval(`lease_until` 만료 → `interrupted`, 부분 응답 보존) · (b) 외부 스케줄러 | (a) 단일 서버 전제(S5 배포 방식과 일치), 배포물 하나. (b) 운영 구성요소 추가 | **(a)** — 다중 인스턴스는 S5 결정 |
| S3-3 | **시간 제한·한도 상수** | (a) PRD FR-33 값(첫 토큰 60초/파일 360초/토큰 사이 60초)과 요청 한도(D18 값)를 **설정값 기본**으로 · (b) 확정 대기 | (a) S2-6과 같은 방식, 비기능 회신 오면 기본값만 갱신 | **(a)** |
| S3-4 | **원본 요청 JSON 저장** | (a) `chat_request.snapshot` jsonb, 크기가 크면(예 1 MB 초과) `FileStorageService`에 파일로 두고 `storage_key` · (b) 항상 jsonb · (c) 항상 파일 | (a) data-contract §5 그대로, 조회는 한 API. (b) 큰 요청(수십 MB 본문 전달)이 DB를 키움. (c) 작은 요청도 파일 I/O | **(a)** |
| S3-5 | **가짜 OpenWebUI 파일 API** | (a) compose `server.mjs`에 업로드·처리 상태(`GET /api/v1/files/{id}` → `processed`)·지연·실패 주입(특정 파일명이면 실패)을 추가해 E2·S5 재현 · (b) 단위 테스트에서만 fetch 스텁 | (a) E2E로 실환경과 같은 경로 검증(D31: 실환경은 사내에서만이라 가짜가 유일한 통합 검증). (b) 요청 경로 전체를 못 봄 | **(a)** — 실환경 차이는 사내 확인 때 어댑터로 |
| S3-6 | **presence(U5a) 구현 위치** | (a) ③에서 `/api/events`의 휘발성 이벤트(`typing`, DB 저장 없음) · (b) S4로 미룸 | (a) 결정 U5(a) 그대로, 채널이 생기는 김에 · (b) 대응표 1행 지연 | **(a)** |
| S3-7 | **재시도 정책** | (a) 데모 그대로 — 자동 재전송 없음, 최근 실패 답변만 사람이 재시도(빼고 다시·텍스트로) · (b) 네트워크 오류 자동 1회 재시도 | (a) D15·PRD FR-33·HANDOFF §2 원칙. (b) 원칙 위반 | **(a)** |
| S3-8 | **Mock provider 범위** | (a) 개발·E2E는 `LLM_MODE=mock`(데모 `mockProvider`·시나리오 이식 완료) — S8 "사용한 자료 드러내기"도 Mock으로 검증 · (b) E2E도 가짜 OpenWebUI live로 | (a) U8(a)와 일치, 결정적 응답. 파일 전달 경로(S5·E2)만 `live`+가짜 OpenWebUI로 별도 E2E | **(a)** — E2E 두 모드 모두 compose 안에서 |

## 결정 반영 지점

- D6·D15·D17·FR-31·36: 서버가 강제 — 직접 태그 공유만 후보, 자동 절단·요약·재귀 없음, 파일 전달 실패는 중단 + 항목별 선택, 업무 절차 프롬프트 없음(promptBuilder 이식분 유지).
- "보낸 것 = 본 것": ①·③이 같은 `buildChatRequest`를 쓴다 — 단위 테스트로 추정 결과와 실제 요청 스냅샷의 동일성 단언.
- KI-7(첨부 개수 한도 표시)·요청 한도 설정값은 ③의 추정 API 응답에 한도를 실어 해소.
- 사내 OpenWebUI 미확인(G1): ①의 어댑터 경계(`LLM_PRESET`·`openwebuiFiles`)를 유지하고, 사내 검증 결과가 오면 그 파일만 맞춘다.

## 완료 기준 (Verification)

1. ①–③ 각: 이식 테스트 먼저 통과 → 단위·DB → typecheck·lint 0 → CI(ubuntu+windows) 녹색 → codex-critic 리뷰 반영
2. E2E: E1 S5–S8, E2, E3a–d, E4, E6 (compose: mock 모드 + 파일 전달은 가짜 OpenWebUI live)
3. 대응표 S3 배정 21행(+S2·S3 겹침) ✅ 갱신, 남은 수 보고
4. 문서: openapi 정합, HANDOFF §6, setup 가이드(새 설정값), KNOWN_ISSUES

## 워커 쓰기 범위 (승인 요청값)

- ①: `apps/api/**, apps/web/**, packages/**, e2e/**, docker/**, docs/architecture/postgres-draft.sql, .env.example`(가짜 OpenWebUI 확장·부분 고유 인덱스 마이그레이션)
- ②·③: `apps/api/**, apps/web/**, packages/**, e2e/**, docs/architecture/postgres-draft.sql, .env.example`
- codex-critic: `none`

## 위험

- **가장 큰 위험 = 실제 OpenWebUI 파일 API 형태(D31)**: 가짜 서버는 데모가 본 형태를 재현한 것. 사내 검증 전까지 `openwebuiFiles.ts`·가짜 서버가 가정. → 사내 real-env-verification C1–C9를 S3 중에라도 한 번 수행 요청.
- 데모 `chatRunner.ts`(332줄)의 탭 메모리 상태를 서버 작업으로 옮기며 **프로세스 재시작 시 진행 중 요청**을 `interrupted`로 정리해야 함(PRD §6 가용성) — ①에 기동 시 정리 포함.
- SSE는 리버스 프록시 버퍼링에 민감(S5 배포 시 `X-Accel-Buffering`/타임아웃 설정) — KNOWN_ISSUES에 미리 기록.
