# 데모 기능 대응표 (parity matrix)

데모(`mes-assistant-platform2`, 태그 `demo-final`)의 모든 모듈·라우트·설정·E2E를 한 줄씩 새 저장소에 대응시킨다.
**목표: 데모 기능 100% 수용** — 이 표에서 `제외`로 명시한 것만 빠진다. 기능을 옮길 때는 이 표의 데모 경로를 **직접 열어** 동작·엣지케이스를 확인하고, 데모 테스트가 있으면 먼저 이식한다(CLAUDE.md "이식 원칙").

- 작성: 2026-09-28, 데모 소스 직접 조사(`src/features`·`src/app`·`src/llm`·`src/db/repositories`·`src/components`·`src/lib`·`e2e/`)
- 스프린트: architecture §9 — S1 OpenWebUI 대리 호출 · S2 에이전트·대화·태그·파일·입력 선택 API + 웹 저장소 함수 교체 · S3 참조 대화·요청 서비스·추정 API·SSE · S4 SR·체크리스트·노트·알림·리포트·설정·권한 전체 · S5 비기능·배포·이관 도구
- 이식 방식: **그대로**(코드·테스트 거의 그대로) · **변경**(서버 이전·저장소 교체·권한 등 명시한 점만 바뀜) · **제외**(대체 수단 명시) · **결정 필요**(PRD에 없음 — §10에서 2026-09-28 모두 확정, 본문에는 `U<n>(a)`로 표기)
- 상태: ✅ S0 이식 완료 · ⬜ 미착수

## 1. 라우트

| 데모 라우트 | 화면 | FR | 스프린트 | 방식 | 상태 |
|---|---|---|---|---|---|
| `/` (카드) · `?view=kanban` | 허브: 에이전트 카드 ↔ 전체 대화 칸반 | 화면 §3, FR-60(순서) | S0 셸·빈 허브 → S2 | 변경(API) | ✅ S2 ①·②(실시간 반영은 S3 ③) |
| `/new/:assistantId` | 새 대화 초안(지연 생성, `?tag=`·`?ref=`) | FR-01·02·20 | S2 | 변경(API) | ✅ S2 ②(첨부로 생성은 ③, `?ref` 선택은 S3) |
| `/c/:taskId` | 대화 화면 | FR-01–41 | S2–S4 | 변경(API) | ✅ 골격(S2 ②: 헤더·팀 의견·이력. 자료 ③, AI S3, 체크·노트 S4) |
| `/tasks/:taskId` | 옛 주소 → `/c/:taskId` 리다이렉트 | — | S2 | 그대로 | ✅ S2 ② |
| `/assistants/manage` | 에이전트 관리 | FR-60 | S4 | 변경(SO 전용 서버 강제) | ✅ |
| `/sr` · `/sr/manage` | SR 접수 · 관리 | FR-50·51 | S4 | 변경(요청자 범위 서버 강제) | ✅ |
| `/reports` | 리포트(지연 로딩) | FR-62 | S4 | 변경(서버 집계) | ✅ |
| `/settings` | 설정 | FR-61 | S4 | 변경(전역=SO·서버, 키 입력 삭제) | ✅ |
| `*` → `/` | 없는 경로 | — | S0 | 그대로 | ✅ |
| (신규) `/login` · `/signup` · `/logged-out` | 앱 자체 로그인·회원가입·로그아웃(D34, `AUTH_MODE=oidc`면 SSO) | 화면 §3 | S0 → S1 | 신규 | ✅ |

## 2. `src/app`

| 데모 모듈 | 하는 일 | FR | 스프린트 | 방식 | 상태 |
|---|---|---|---|---|---|
| `AppShell.tsx` | 사이드바·NAV·Toaster·시스템 assistant 서랍 | 화면 §3 | S0 → 화면별 NAV 추가 | 변경(NAV는 화면이 생길 때 추가, 서랍은 결정 U1) | ✅ 셸 |
| `TopBar.tsx` | 제목·LLM 모드 배지·시스템 assistant 버튼·알림 종·사용자 전환 | — | S0 → S4 | 변경(사용자 전환 → 로그인 사용자·로그아웃. 배지는 S1에서 SO 전용으로(`/api/llm/status`). 버튼은 U1·S4) | ✅ 일부(셸·배지) |
| `chatRunner.ts` (+test) | 요청 실행기: 활성 1건·생존 신호·시간 제한·재시도·중지·끊긴 응답 정리 | FR-33 | S3 | 변경(서버 RequestService, `lease_until`·주기 작업) — 테스트 먼저 이식 | ✅ |
| `hooks.ts` | 현재 사용자·설정·사용자 목록 훅 | — | S2 | 변경(TanStack Query) | ✅ 일부(S2 ①: 사용자 목록·카탈로그. 설정 훅은 S4 설정 API 뒤) |
| `NotificationBell.tsx` | 알림 종(읽음 처리 후 이동) | FR-41 | S4 | 변경(API·SSE) | ✅ |
| `presence.ts` | 같은 브라우저 탭 간 "입력 중" 표시(BroadcastChannel) | — | S3 | 변경(U5(a): SSE 이벤트로 다른 PC까지, 휘발성·DB 저장 없음) | ✅ |
| `router.tsx` | 라우트·리포트 지연 로딩 | — | S0 → 화면별 | 그대로 | ✅ 일부 |
| `tabUser.ts` | 탭별 사용자 전환(시연용) | — | — | **제외** — 로그인 사용자로 대체(architecture §3) | — |
| `uiStore.ts` | 홈 필터·칸반 빈 열 접기·서랍 열림(브라우저 저장) | 화면 §3 | S2 | 그대로(개인 화면 설정은 브라우저) | ✅ S2 ① |
| `useMediaQuery.ts` | 좁은 화면 판정 | — | S2 | 그대로 | ✅ S2 ① |
| `useTagSuggest.ts` | 태그 자동완성(빈도순 + 접수 SR 코드) | FR-02 | S2 | 변경(API `GET /api/tags/suggest`, SR 코드는 S4) | ✅ S2 ② |

## 3. `src/features`

### home
| 데모 모듈 | 하는 일 | FR | 스프린트 | 방식 | 상태 |
|---|---|---|---|---|---|
| `HomePage.tsx` | 카드↔칸반 세그먼트 토글(URL `view`) | 화면 §3 | S2 | 변경(API) | ✅ 카드 뷰(S2 ①) · 칸반은 ② |
| `AssistantCard.tsx` | 에이전트 카드 본문 | 화면 §3 | S2 | 그대로(이미지는 S4 이미지 API 뒤, 지금은 이니셜. OpenWebUI 열기 버튼의 기본 링크 규칙은 U9(a) S4 전역 설정 뒤 — 지금은 link1이 있을 때만) | ✅ S2 ①(링크 기본 규칙은 S4) |
| `SortableAssistantGrid.tsx` | SO 편집 모드 드래그 순서(저장/취소, 필터 중 차단) | FR-60 | S2(표시)·S4(편집 권한) | 변경(충돌 검사 `revision`) | ✅ |
| `CardMapFilterBar.tsx` | 카드 검색·Lv1/Lv2 필터·중단 에이전트 보기 | — | S2 | 그대로(U4(a)) | ✅ S2 ① |
| `useAssistantStats.ts` | 카드별 대화 집계 | 화면 §3 | S2 | 변경(서버 집계 `GET /api/assistants/stats`) | ✅ S2 ① |
| `ConversationKanban.tsx` | 전체 대화 칸반(열=에이전트, 필터 URL 공유) | 화면 §3, D3 | S2 | 변경(API) | ✅ S2 ② |
| `ConversationCard.tsx` | 칸반 카드(완료는 대화 화면에서만) | FR-01 | S2 | 그대로 | ✅ S2 ② |

### conversation · task
| 데모 모듈 | 하는 일 | FR | 스프린트 | 방식 | 상태 |
|---|---|---|---|---|---|
| `conversation/DraftConversationPage.tsx` | 초안 대화, 첫 전송·첨부 때 생성, `?tag=`·`?ref=` 미리 채움, 추천 질문 칩 | FR-01·02·20 | S2 | 변경(API) · 추천 칩은 U2 | ✅ S2 ②·③(`?ref` 선택은 S3 ②) |
| `task/TaskPage.tsx` | 대화 화면 진입, 초안 첫 메시지 인계(중복 전송 방지) | FR-01 | S2 | 그대로 | ✅ S2 ② |
| `task/TaskHeader.tsx` | 제목·상태·태그·연결된 대화·재개 사유 | FR-01·02·03 | S2 | 변경(API) | ✅ S2 ②(연결된 SR은 S4) |
| `task/RelatedStrip.tsx` | 태그를 직접 공유하는 다른 대화 줄(최근 활동순) | — | S2 | 그대로(U3(a): 직접 공유만, 태그 떼면 사라짐) | ✅ S2 ② |
| `task/TaskBody.tsx` | 채팅 + 오른쪽 [자료·체크·노트·이력], 좁은 화면 탭 | 화면 §3 | S2 | 그대로 | ✅ 골격(S2 ②: 이력 탭 동작, 자료 ③·체크·노트 S4) |
| `task/useTaskData.ts` | 같은 태그 대화 후보 + 원문 규모 | FR-20 | S2·S3 | 변경(API) | ✅ 일부(S2 ③: 파일 후보 `GET candidates`. 대화 후보·원문 규모는 S3) |
| `task/MaterialsPanel.tsx` | 자료함: AI 입력·공유 자료함·SR 첨부·이 대화 파일 | FR-10·12 | S2 | 변경(API) | ✅ S2 ③(SR 첨부 탭은 S4) |
| `task/FileList.tsx` | 파일 목록·산출물 토글·출처 뱃지 | FR-10·13 | S2 | 변경(API) | ✅ S2 ③ |
| `task/FilePreviewDialog.tsx` | 텍스트·이미지 미리보기 | FR-15 | S2 | 변경(파일 API `GET /api/files/{id}/content`) | ✅ S2 ③ |
| `task/FileVersionsDialog.tsx` | 버전 체인(최신→과거) | FR-11·15 | S2 | 변경(API) | ✅ S2 ③ |
| `task/InputToggle.tsx` | ☑참고/★주 입력 토글 | FR-10·20 | S2 | 그대로 | ✅ S2 ③ |
| `task/ConversationInputs.tsx` | 참조 대화 입력 목록·갱신 안내 | FR-20–22 | S3 | 변경(API) | ✅ |
| `task/ConversationPickerDialog.tsx` | 전체·메시지 범위·요약 선택 | FR-21 | S3 | 변경(API, 요약은 서버 대리 호출) | ✅ |
| `task/ChecklistPanel.tsx` | 체크리스트(강제 아님) | FR-40 | S4 | 변경(API) | ✅ |
| `task/ChecklistReviewCard.tsx` | AI 달성도 m/n·"판단대로 체크" | FR-40 | S4 | 변경(서버 대리 호출) | ✅ |
| `task/NotesPanel.tsx` | 노트(첨부) | FR-41 | S4 | 변경(API) | ✅ |
| `task/ActivityPanel.tsx` | 활동 이력 | FR-41 | S2 ②(앞당김) | 변경(API `GET /api/tasks/{id}/activity`) | ✅ S2 ② |
| `task/TaskCompleteDialog.tsx` | 완료 절차(리포트·입력 출처·피드백) | FR-01·62 | S4 | 변경(API) | ✅ |

### chat
| 데모 모듈 | 하는 일 | FR | 스프린트 | 방식 | 상태 |
|---|---|---|---|---|---|
| `ChatView.tsx` | 채팅 화면·입력 중 표시·추천 칩 | FR-04 | S2·S3 | 변경(SSE) · presence U5 · 칩 U2 | ✅ S2 ②·S3 ①(스트리밍·중지. presence U5는 S3 ③) |
| `Composer.tsx` | 입력창·첨부(기본 고정, "이번 메시지만") | FR-10 | S2 | 변경(업로드 API) | ✅ S2 ②·③·S3 ①(텍스트·첨부·AI 전송·중지) |
| `ContextTray.tsx` | "이번 요청에 사용" 트레이·크기·초과 시 조절 | FR-30·31 | S3 | 변경(서버 추정 API) | ✅ |
| `useRequestEstimate.ts` | 트레이 추정(dryRun 같은 조립 함수) | FR-30 | S3 | 변경(서버 추정 API) | ✅ |
| `MessageBubble.tsx` | 답변·사용한 자료·실패 복구(재시도·빼고 다시·텍스트로) | FR-32·34 | S3 | 변경(API) | ✅ S3 ① |
| `RequestInfoDialog.tsx` | 전송 기록 뷰어·원본 JSON | FR-34 | S3 | 변경(API) | ✅ S3 ① |
| `requestLabels.ts` | 전달 방식 표기(트레이·사용한 자료 공통) | FR-30·34 | S3 | 그대로 | ✅ S3 ① |
| `ModelPicker.tsx` | 대화/스레드 모델 지정(서버 모델 목록 자동완성) | FR-35 | S2 | 변경(API) · 목록은 U6 | ✅ S2 ②(대화 모델. 스레드 모델은 S3) |
| `SaveAsOutputDialog.tsx` | 답변 → 산출물(기본 이름 규칙·버전) | FR-13 | S2 | 변경(API `POST /api/tasks/{id}/outputs`) | ✅ S2 ③(실제 답변 흐름은 S3) |
| `suggestions.ts` | 사용 예시에서 추천 질문 칩 추출 | — | S2 | 그대로(U2(a): 사람이 누르는 입력 도우미) | ✅ S2 ② |
| `useChat.ts` | 실행기 래퍼(전송·중지·재시도) | FR-33 | S3 | 변경(API·SSE) | ✅ S3 ①(SSE 파서·run 상태·재시도·중지) |

### sr · assistants · reports · settings · system-assistant
| 데모 모듈 | 하는 일 | FR | 스프린트 | 방식 | 상태 |
|---|---|---|---|---|---|
| `sr/SrIntakePage.tsx` | 접수 대화·탭(/sr ↔ /sr/manage) | FR-50 | S4 | 변경(요청자 권한) | ✅ |
| `sr/SrList.tsx` | SR 목록(draft는 첫 메시지) | FR-50 | S4 | 변경(API) | ✅ |
| `sr/SrConvertDialog.tsx` | draft → 접수 전환·접수 내용 수정(AI 제목) | FR-50 | S4 | 변경(서버 대리 호출) | ✅ |
| `sr/SrTitleEditor.tsx` | 제목 수정(요청자·SO만, 수동 제목 보호) | FR-50 | S4 | 변경(서버 강제) | ✅ |
| `sr/SrManagePage.tsx` | SR 관리·연결 대화 | FR-51 | S4 | 변경(API) | ✅ |
| `sr/SrDetailSheet.tsx` | 진행 현황·연결 업무 시작(이어가기/새 대화) | FR-51 | S4 | 변경(API) | ✅ |
| `sr/ShareResultDialog.tsx` | 결과 공유(텍스트 + 산출물) | FR-51 | S4 | 변경(API) | ✅ |
| `sr/SharedResults.tsx` | 요청자: 공유된 결과만 | FR-51 | S4 | 변경(서버 강제) | ✅ |
| `assistants/ManagePage.tsx` | 에이전트 관리 화면 | FR-60 | S4 | 변경(SO 전용) | ✅ |
| `assistants/AssistantTable.tsx` | 목록·모델 ID 인라인 매핑 | FR-60·35 | S4 | 변경(API) · 목록은 U6 | ✅ |
| `assistants/AssistantEditorSheet.tsx` | 전 항목 편집·체크리스트 기본값·삭제 보호 | FR-60·40 | S4 | 변경(API) | ✅ |
| `assistants/ImageDropzone.tsx` | 에이전트 이미지 | FR-60 | S4 | 변경(파일 API) | ✅ |
| `reports/ReportsPage.tsx` | 완료 추이·에이전트별 리드타임·사용자별 활동·SR 상태·자료 흐름·태그별 대화·에이전트별 현황·피드백 다이제스트 | FR-62 | S4 | 변경(서버 집계, 완료 이벤트 시각 기준) | ✅ |
| `reports/charts.tsx` | 차트 팔레트 | FR-62 | S4 | 그대로 | ✅ |
| `settings/SettingsPage.tsx` | 아래 "설정 항목" 표 | FR-61 | S4 | 변경 | ✅ |
| `system-assistant/SystemAssistantDrawer.tsx` | 플랫폼 조작용 시스템 assistant(제안 카드 → 확인 후 적용) | — | S4 | 변경(U1(a): 서버 대리 호출, 제안 카드 → 사용자 확인 → 기존 API·권한 그대로) | ✅ |
| `system-assistant/actions.ts` | 도구 호출 → 제안 변환 | — | S4 | U1(a) | ✅ |

## 4. `src/llm`

| 데모 모듈 | 하는 일 | FR | 스프린트 | 방식 | 상태 |
|---|---|---|---|---|---|
| `context.ts` (+test) | 플랫폼 컨텍스트 system 메시지·참조 대화 절 | FR-36 | S0 | 그대로(파일 바이트는 포트) | ✅ |
| `promptBuilder.ts` (+test) | 요청 조립·전달 방식 기록·크기(dryRun=트레이) | FR-30–32·34 | S0 → S3 서버 실행 | 변경(`LlmPorts`) | ✅ 이식 |
| `openwebuiFiles.ts` (+test) | 업로드·처리 확인·버전 이름·원격 ID | FR-32 | S0 → S1 | 변경(서버 비밀 키, `FileStorageService`) | ✅ 이식 |
| `openaiProvider.ts` | OpenAI 호환 SSE 스트리밍 | FR-33 | S0 → S1 | 변경(서버 대리 호출. S1: `listModels` 실패 시 빈 배열 대신 오류(서버가 502로), 오류 메시지에서 상위 응답 본문 제거) | ✅ 서버에서 생성(S1) |
| `sse.ts` (+test) | SSE 파서 | FR-33 | S0 | 그대로 | ✅ |
| `provider.ts` · `index.ts` | provider 인터페이스 | — | S0 | 그대로 | ✅ |
| `conversationSummary.ts` (+test) | 요청 시 요약(Mock 대역 포함) | FR-21 | S0 → S3 | 그대로 | ✅ |
| `title.ts` | AI 제목 | FR-03·50 | S0 → S2 | 그대로 | ✅ |
| `checklistReview.ts` | AI 달성도 | FR-40 | S0 → S4 | 그대로 | ✅ |
| `mockProvider.ts` · `mockScenarios.ts` (+test) | Mock 대역 응답(개발·E2E) | — | S0 | 그대로(개발·E2E용) | ✅ |
| `mockSystemAssistant.ts` | 규칙 기반 시스템 assistant | — | S0(코드만) | U1 | ✅ 코드 |
| `tools.ts` | 시스템 assistant 도구 3종(start_conversation·create_assistant·add_tag) | — | S0(코드만) | U1 | ✅ 코드 |
| `useModelList.ts` | 모델 목록(Live `/models`, Mock 예시) | FR-35 | S1 | 변경(U6(a): 서버가 OpenWebUI `/api/models` 대리 조회, 키는 서버 — `GET /api/llm/models`, 60초 캐시) | ✅ |

## 5. `src/db/repositories` (→ api 서비스 + web API 클라이언트, **같은 함수 이름·인자**, data-contract §6)

| 데모 모듈 | 함수 | FR | 스프린트 | 방식 | 상태 |
|---|---|---|---|---|---|
| `tasks.ts` | `nextCode` `startConversation` `setTaskTitle` `updateTask` `addTag` `removeTag` `assertNotDone` `setInput` `switchInputVersion` `setTaskStatus` `setTaskModel` `setThreadModel` `deleteTask` | FR-01·02·03·10·11·35 | S2 | 변경(서버, 코드는 advisory lock 시퀀스) | ✅ S2 ②·③(`setThreadModel`은 S3) |
| `tasks.ts` | `toggleChecklist` `addChecklistItem` `removeChecklistItem` `saveChecklistReview` `applyChecklistReview` `giveFeedback` | FR-40·01 | S4 | 변경(서버) | ✅ |
| `chat.ts` | `createThread` `setActiveThread` `nextMessageTime` `appendMessage` `isLiveReply` `assertNoActiveReply` `updateMessage` `deleteThread` `STALE_MS` `STALE_ERROR` | FR-04·33 | S2·S3 | 변경(`message.seq`, 활성 1건은 DB 인덱스) | ✅ S2 ②·S3 ①(활성 응답·정리는 chat_request로) |
| `conversationInputs.ts` (+test) | `selectConversation` `applyConversationSummary` `refreshConversationInput` `setConversationWeight` `removeConversationInput` `findConversationInput` `loadConversationInputs` | FR-20–23 | S3 | 변경(서버) — 테스트 먼저 | ✅ |
| `files.ts` (+test) | `fileVersions` `uploadFile` `saveAssistantOutput` `setOutputTag` `deleteFile` `filesForTask` `downloadBlob` `isTextFile` `formatSize` | FR-10–15 | S2 | 변경(`FileStorageService`, 소프트 삭제) — 테스트 먼저 | ✅ S2 ③(`blob`은 서버 `/content`) |
| `assistants.ts` (+test) | `newChecklistTemplateItem` `defaultChecklistTemplate` `createAssistant` `updateAssistant` `setAssistantStatus` `setAssistantImage` `deleteAssistant` `reorderAssistants` | FR-60·40 | S2(읽기)·S4(편집) | 변경(SO 전용, `revision` 충돌 검사) — 테스트 먼저 | ✅ |
| `sr.ts` | `startSrConversation` `submitSr` `setSrTitle` `conversationsForSr` `startTaskFromSr` `updateSrContent` `setSrStatus` `deleteDraftSr` `shareSrResult` | FR-50·51 | S4 | 변경(서버, 요청자 범위 강제) | ✅ |
| `notes.ts` | `addNote` `deleteNote` | FR-41 | S4 | 변경(서버) | ✅ |
| `notifications.ts` (+test) | `notify` `unreadCount` `markRead` `markAllRead` | FR-41 | S4 | 변경(서버·SSE) — 테스트 먼저 | ✅ |
| `activity.ts` | `logActivity` | FR-41 | S2 | 변경(서버, 추가만) | ✅ S2 ② |
| `settings.ts` | `getSettings` `setLlmSettings` `setRequestBudget` `setSrIntakeAssistant` | FR-61 | S4 | 변경(`app_setting`, SO 전용, 키 제외) | ✅ |
| `settings.ts` | `DEFAULT_USER_ID` `setCurrentUser` | — | — | **제외** — 로그인 사용자 | — |
| `conversations.test.ts` | 대화 생성·태그·입력 규칙 테스트 | FR-01·02·10 | S2 | 테스트 먼저 이식 | ✅ S2 ②·③(DB 테스트로 이식) |
| (db) `schema.ts` · `migrations/*` · `seed/*` | Dexie 스키마·시드 | — | S0 | **제외** — Drizzle(✅), 시드는 개발 픽스처로만 | ✅ |
| (db) `exportImport.ts` (+test) | JSON 내보내기·가져오기(비밀값 제외) | — | S5 | 변경(U7(a): 가져오기만 S5 "데모 데이터 이관 도구"로 · 내보내기는 **제외** — 서버 DB 백업으로 대체) | ✅ |

## 6. `src/domain` (S0 이식 완료 — 61개 테스트)

| 데모 모듈 | FR | 방식 | 상태 |
|---|---|---|---|
| `types` · `tags` · `conversationContext` · `requestBudget` · `kanban` · `transitions` · `titles` · `modelResolution` · `reporting` · `taskReport` · `checklistReview` · `srDraft` | FR-01–62 전반 | 그대로 (`types`는 S2에서 contracts와 정렬) | ✅ |

## 7. `src/components` · `src/lib`

| 데모 모듈 | 스프린트 | 방식 | 상태 |
|---|---|---|---|
| `components/ui/*` (shadcn 27종) | 쓰는 화면과 함께 | 그대로 | ✅ 4종(button·dropdown-menu·tooltip·sonner) |
| `UserAvatar` · `EmptyState` | S0 | 그대로 | ✅ |
| `AssistantAvatar` · `TagChip` · `TagInput` · `StatusBadges` · `Markdown` · `ConfirmDialog` · `ReasonDialog` | S2 | 그대로 | ✅ S2 ① |
| `lib/utils` | S0 | 그대로 | ✅ |
| `lib/dates` | S0 | 그대로(domain에 포함) | ✅ |
| `lib/colors` (이니셜·색) | S0 | 그대로(api `userDisplay`·web) | ✅ api |
| `lib/labels` · `lib/activity` · `lib/clipboard`(+test) · `lib/ids` | S2 | 그대로 | ✅ S2 ① |
| `lib/links`(+test) (OpenWebUI 링크1·외부 링크) | S1·S2 | 변경(베이스 주소는 서버 설정에서) | ✅ S2 ①(테스트 이식) |
| `lib/blob` | — | 그대로(llm에서 포트로 대체, 웹 미리보기에서 필요 시) | ✅ llm |

## 8. 설정 항목 (`SettingsPage`)

| 데모 항목 | FR | 스프린트 | 방식 |
|---|---|---|---|
| LLM 모드 Mock / Live | — | S1 | 변경(U8(a): 서버 배포 설정 `LLM_MODE` — 개발·E2E는 Mock, 운영은 Live. 화면 전환 없음, SO에게 배지만) ✅ S1 |
| 사내 API 프리셋 · Base URL · API Key 입력 | FR-61 | S1 | **제외** — 서버 비밀 저장소·배포 설정(키를 화면에 두지 않음) |
| 기본 모델 | FR-61·35 | S4 | 변경(SO 전용 전역 설정) ✅ S4 ① |
| 입력 파일 전달 방식(OpenWebUI 첨부 / 본문) | FR-61 | S4 | 변경(SO 전용) ✅ S4 ① |
| 요청 크기 한도(KB) | FR-61·31 | S4 | 변경(SO 전용) ✅ S4 ① |
| SR 접수 에이전트 | FR-61·50 | S4 | 변경(SO 전용) ✅ S4 ① |
| 링크1 기본 규칙(링크1 미입력 시) | — | S4 | 변경(U9(a): SO 전역 설정) ✅ S4 ① |
| JSON 내보내기 · 가져오기 · 시드로 초기화 | — | S5 | 변경(U7(a): 가져오기 → S5 이관 도구 · 내보내기·시드 초기화 **제외** — 서버 DB 백업·마이그레이션으로 대체) |

## 9. E2E 시나리오 (데모 `e2e/`) — 같은 기준으로 새 저장소에서 통과시킨다

| 데모 시나리오 | FR | 스프린트 | 상태 |
|---|---|---|---|
| S1 컴포저 첨부는 다음 턴에도 AI 입력으로 남는다 | FR-10 | S2 | ✅ S2 ③(files.spec, AI 전송 없이 입력 고정까지) |
| S2 SR 접수 대화의 첨부는 첨부한 그 메시지에 포함된다 | FR-10·50 | S4 | ✅ |
| S3 기본 이름으로 두 번 저장한 산출물은 같은 파일의 v2 | FR-11·13 | S2 | ✅ S2 ③(files.spec) |
| S4 태그 공유 자료를 ★·☑로 고르면 주 입력이 먼저 전달 | FR-12·20·32 | S2 | ✅ S2 ③(files.spec, 선택·순서까지. 전달은 S3) |
| S5 OpenWebUI 첨부: 처리 완료 확인 후 전송, 주 입력 먼저, 업로드 이름에 버전 | FR-32 | S3(RequestService, S2-3 결정) | ✅ S3 ①(requests-live.spec, 가짜 OpenWebUI live) |
| S6 프롬프트를 만들다 실패해도 입력창이 잠기지 않는다 | FR-33 | S3 | ✅ S3 ①(requests.spec — 크기 초과 실패 기록·입력창 복구) |
| S7 두 탭에서 동시에 보내도 진행 중 요청은 하나 | FR-33 | S3 | ✅ S3 ①(DB 테스트 동시 2건 → 1건. 브라우저 2탭 E2E는 ③ 이벤트와 함께) |
| S8 Mock 응답은 매 턴 사용한 자료(등급·버전)를 드러낸다 | FR-34 | S3 | ✅ S3 ①(requests.spec) |
| E2 OpenWebUI 전달 실패: 요청을 보내지 않고 텍스트로 보내기로 복구 | FR-32 | S3 | ✅ S3 ①(requests-live.spec) |
| E3a 같은 태그 대화만 후보, 통째로 고르면 전체 원문(간접 연결·팀 의견 제외) | FR-20·23 | S3 | ✅ |
| E3b 메시지 범위를 고르면 고른 메시지만 | FR-21 | S3 | ✅ |
| E3c 요약은 누를 때만 만들고 확인·수정한 요약이 간다 | FR-21 | S3 | ✅ |
| E3d 선택 시점 고정, 새 메시지는 갱신을 눌러야 | FR-22 | S3 | ✅ |
| E4 요청 크기 한도 초과 시 전송 차단·안내(자동 절단 없음) | FR-31 | S3 | ✅ |
| E6 답변의 "사용한 자료"에서 전송 기록을 앱 안에서 본다 | FR-34 | S3 | ✅ |
| `support/fakeOpenWebUI.ts` · `support/app.ts` | — | S1·S2 | 변경(가짜 OpenWebUI는 compose 서비스, 로그인 단계 추가) — S0 `docker/fake-openwebui` ✅ 최소판 |

| E5 보호(단위): 프롬프트 생성 실패 → 입력창 풀림 · 두 탭 동시 전송 1건 · 응답 중 완료 거부 · 끊긴 응답 정리 · 중지한 답변 덮어쓰기 방지 · 백업에 키·원격 ID 없음 | FR-33·61 | S3 (`chatRunner.test.ts` 먼저 이식) | ✅ S3 ①(requests.db.test 11건 + 키·원격 ID 비노출) |

> 평가 문서 [../evaluation/context-flow.md](../evaluation/context-flow.md) 기준: **E1 = S1–S8**(`context-flow.spec.ts`), **E2–E4·E6** = `conversation-context.spec.ts`, **E5** = 요청 실행기 보호(단위 테스트). architecture §9의 "S2: 데모 E1 S1–S5", "S3: E2–E5"와 위 배정이 같다(S6–S8은 요청 실행기라 S3).

## 10. 사용자 결정 (2026-09-28 확정)

PRD에 없는 데모 기능 9건. 사용자 회신: **모두 (a)** — 목표는 데모 기능 100% 수용이며, U7만 서버 구조상 의도적 대체다. 본문 표에는 `U<n>(a)`로 표기했다.

| # | 데모 기능 | 결정 | 근거 | 스프린트 |
|---|---|---|---|---|
| U1 | 시스템 assistant 서랍 + 도구 3종(대화 시작·에이전트 등록·태그 추가) | (a) 수용: 서버 대리 호출, 도구는 제안 카드 → 사용자 확인 → 기존 API 호출 | 플랫폼 조작 보조이지 업무 절차 주입이 아님. 권한은 기존 API가 그대로 강제(D19) | S4 |
| U2 | 추천 질문 칩 | (a) 수용 그대로 | 사람이 누르는 입력 도우미 — 자동 전송·절차 지시 없음(HANDOFF §2) | S2 |
| U3 | RelatedStrip(같은 태그 대화 줄) | (a) 수용 그대로 | 직접 공유만 보이고 태그를 떼면 사라짐 — D6과 일치 | S2 |
| U4 | 카드 지도 필터(검색·Lv1/Lv2·중단 보기, 브라우저 저장) | (a) 수용 그대로 | 개인 화면 편의, 서버 상태 없음 | S2 |
| U5 | presence "입력 중" | (a) SSE 이벤트로 다른 PC까지 | 서버 기반이 되면 탭 간 표시만으론 부족. 휘발성, DB 저장 없음 | S3 |
| U6 | 모델 목록 자동완성 | (a) 서버가 OpenWebUI `/api/models` 대리 조회 | 키는 서버에만(D12·HANDOFF §2). 모델 ID 오타 방지 | S1 |
| U7 | JSON 내보내기·가져오기·시드 초기화 | (a) **가져오기**만 S5 "데모 데이터 이관 도구"(PRD §7 선택)로 수용. **내보내기·초기화는 제외** — 서버 DB 백업·마이그레이션으로 대체 | 데모의 브라우저 DB 백업 수단이 서버 구조에서는 불필요. **유일한 의도적 대체** | S5 |
| U8 | LLM 모드 Mock/Live 전환 | (a) 서버 배포 설정(개발·E2E Mock, 운영 Live), 화면 전환 없음 | 운영 중 사용자가 Mock으로 바꾸는 상황이 없음. 설정은 코드·환경에 | S1 |
| U9 | 링크1 기본 규칙(`{OpenWebUI}/?model={모델 ID}`) | (a) SO 전역 설정 | OpenWebUI 주소·경로는 배포마다 다름(D12) | S4 |
