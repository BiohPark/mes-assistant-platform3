# 데이터 계약 — 데모(IndexedDB) → 새 저장소(서버·DB·파일)

작성일: 2026-09-26 · 대상: 데모 스키마 v4 (`src/db/schema.ts`) · 상태: **설계 문서** — 실제 서버·DB는 새 저장소에서 구현한다.

이 문서는 데모가 다루는 데이터를 **무엇을 DB에 두고, 무엇을 파일로, 무엇을 두지 않을지** 나누고, 새 저장소가 그대로 옮겨 쓸 수 있는 형태(엔티티·불변 조건·API·DDL)로 정리한다. DDL 초안: [postgres-draft.sql](postgres-draft.sql). 배경: [../fusion-design.md](../fusion-design.md) §1·§8.

## 1. 저장 분류

| 분류 | 예 | 데모(현재) | 새 저장소 |
|---|---|---|---|
| **영속 업무 데이터** | 대화(업무)·메시지·태그·입력 선택·참조 대화·SR·체크리스트·노트·활동·알림 | IndexedDB 테이블 | DB 테이블 (§3, DDL) |
| **파일 본문** | 업로드·산출물·SR 첨부·에이전트 이미지 | `files` 행의 blob (데모 한정) | **디스크·NAS에 파일 그대로**. DB에는 메타데이터와 `storage_key`만 (§4) |
| **요청 기록** | 답변별 사용 자료·전달 방식·크기, 원본 요청 JSON | 답변 메시지의 `requestInfo`·`requestSnapshot` | `chat_request` + `chat_request_input` (§5) |
| **실행 상태** | 응답 중 표시, 생존 신호, 진행 단계 | 메시지 `status='streaming'`·`heartbeatAt`, 탭 메모리 | 서버 작업 상태 (응답이 끝나면 요청 기록으로 확정) |
| **비밀** | OpenWebUI API 키 | 브라우저 IndexedDB (**백업 제외**) | 서버 비밀 저장소. 브라우저에 두지 않음 |
| **원격 캐시** | OpenWebUI 파일 ID(재사용) | `files.remoteIds` (백업 제외) | `file_remote_ref` (서버) |
| **화면 설정** | 홈 필터, 빈 열 접기 | localStorage | 클라이언트 유지 (선택: 사용자 설정 테이블) |
| **탭 세션** | 이 탭의 현재 사용자 | sessionStorage | 인증 세션(SSO) |
| **파생 값** | 공유 자료함, 대화 후보, 칸반 열, 리포트, 요청 크기 추정 | 매번 계산 | 매번 계산 (저장하지 않음) |

## 2. 원칙 (불변 조건)

새 저장소에서도 지켜야 하는 규칙이다. 괄호는 데모 코드 위치.

1. **대화 1개 = 업무 1개 = 스레드 1개.** (`Task.threadId`)
2. **발견과 사용의 분리.** 같은 태그를 *직접* 공유하는 대화의 파일·대화가 후보로 보이고, 사람이 ☑/★로 고른 것만 AI에 간다. 간접 연결(A–B–C)은 후보가 아니다. 단계·에이전트 순서는 조건이 아니다. (`domain/tags.ts sharedPool`, `domain/conversationContext.ts`)
3. **파일 버전은 불변.** 같은 대화·같은 이름으로 다시 저장하면 새 행(`version+1`, `previous_id`). 입력 선택은 특정 버전을 고정하며 새 버전이 생겨도 자동 교체하지 않는다. (`repositories/files.ts`)
4. **참조 대화는 선택 시점 스냅샷에 고정.** 스냅샷은 불변이고 메시지 ID만 가리킨다(완료된 메시지는 수정되지 않으므로 복사하지 않는다). 요약 모드만 사람이 확인한 본문을 저장한다. 갱신 = 새 스냅샷. (`repositories/conversationInputs.ts`)
5. **재귀 수집 없음.** 참조 대화 자신의 메시지만 전달하고, 그 대화의 입력·참조는 따라가지 않는다.
6. **자동 절단·자동 요약 없음.** 요청 크기 한도를 넘으면 보내지 않고 사용자가 줄인다. (`domain/requestBudget.ts`)
7. **대화당 진행 중 요청 1건.** 확인과 생성은 한 트랜잭션. 응답 중에는 완료할 수 없다. (`db/repositories/chat.ts assertNoActiveReply`, `app/chatRunner.ts`)
8. **요청 기록은 보낸 시점의 사실.** 이후 선택을 바꿔도 기록은 바뀌지 않는다. 비밀값은 기록하지 않는다.
9. **삭제 보호.** 다른 대화가 입력으로 쓰는 파일·대화는 삭제하지 않는다. (`deleteFile`, `deleteTask`)
10. **완료 잠금.** 완료된 대화의 입력 구성은 재개한 뒤에만 바꾼다. (`assertNotDone`)
11. **요청자 공개 범위.** 요청자는 자기 SR 접수 대화와 명시적으로 공유된 결과(`shared_result`)만 본다. 태그는 권한이 아니다. — 데모는 인증이 없어 강제하지 않는다. **새 저장소에서 서버가 강제한다.**

## 3. 엔티티

데모 테이블 → 새 저장소 테이블. "내장 배열"은 데모에서 행 안에 들고 있는 값으로, DB에서는 자식 테이블로 나눈다.

| 데모 테이블 | 주요 필드 | 내장 배열 → 자식 테이블 | 새 저장소 |
|---|---|---|---|
| `users` | id, name, role, initials, color, isSystemOwner | — | `app_user` (+ SSO 주체 ID) |
| `assistants` | id(slug), name, level1/2, summary, order, modelId, link1, docUrl, ownerId, status, usageExample, imageId, color | `expectedInputs/Outputs[]` → `assistant_expected_io`, `checklistTemplate[]` → `assistant_checklist_template` | `assistant` (slug는 고유 키, PK는 별도) |
| `tasks` | id, code(WK-YYYY-NNNN), assistantId, title, titleSource, summary, status, ownerId, priority, dueDate, threadId, modelId, 시각들 | `assigneeIds[]` → `task_assignee`, `tags[]` → `tag`+`task_tag`, `inputs[]` → `task_input`, `outputFileIds[]` → `file_object.is_output`, `checklist[]` → `checklist_item`, `checklistReview` → `checklist_review(+_item)`, `feedback` → `task_feedback` | `task` (code 고유) |
| `threads` | id, taskId \| srId, title, modelId | — | `thread` (task 또는 SR 중 정확히 하나) |
| `messages` | id, threadId, role, content, authorId, status, kind, createdAt, requestInfo, requestSnapshot, heartbeatAt, requestedBy | `attachmentIds[]` → `message_attachment`, `requestInfo` → `chat_request`(+input) | `message` (+ 스레드 내 순번 `seq`) |
| `files` | id, originTaskId \| originSrId, name, mime, size, **blob**, source, version, previousId, uploadedBy/At | `tags[]`(마커) → 컬럼(`kind`, `is_output`), `remoteIds` → `file_remote_ref` | `file_object` (blob 없음, `storage_key`) |
| `conversationInputs` | id, taskId, sourceTaskId, weight, mode, snapshotId, selectedBy/At | — | `conversation_input` (task+source 고유) |
| `contextSnapshots` | id, sourceTaskId, mode, messageIds, upToMessageId, summaryText, summarySource/Model | `messageIds[]` → `context_snapshot_message` | `context_snapshot` |
| `serviceRequests` | id, code(SR-YYYY-NNNN), requesterId, title, titleSource, body, status, threadId | `attachmentIds[]` → `file_object.origin_sr_id`, `results[]` → `shared_result`(+`shared_result_file`) | `service_request` (code 고유, 접수 전은 NULL) |
| `notes` | id, taskId, authorId, content | `attachmentIds[]` → `note_attachment` | `note` |
| `activity` | id, taskId/assistantId/srId, userId, type, payload, at | — | `activity_log` (payload jsonb) |
| `notifications` | id, userId, title, body, link, at, read | — | `notification` (`read_at`) |
| `settings` | id='app', currentUserId, srIntakeAssistantId, llm, requestBudgetBytes | — | `app_setting`(전역) — `currentUserId`는 세션, `llm.apiKey`는 서버 비밀 |

**ID**: 데모는 `접두어_UUID` 문자열(`task_…`, `msg_…`, `file_…`). 새 저장소는 가져오기를 단순하게 하려고 **문자열 PK를 그대로 받는다**(DDL의 `text` PK). 새로 만드는 행은 서버가 UUID로 발급한다.

**업무 코드**: 데모는 클라이언트가 최대값+1로 만든다(동시 생성 시 중복 가능 — 데모 한계). 새 저장소는 DB 시퀀스·고유 제약으로 발급한다.

## 4. 파일 저장 경계 — 파일은 파일 그대로

```
업로드 ──▶ 서버 FileStorageService ──▶ {root}/{yyyy}/{MM}/{fileId}      (원본 바이트 그대로)
                    │
                    └──▶ file_object (id, original_name, mime, size, sha256, storage_key, version, previous_id, ...)
```

- **경로**: `storage_key = yyyy/MM/{fileId}`. 원래 파일 이름은 DB에만 둔다 → 한글·특수문자·경로 조작 문제가 없다. 경로는 서버가 만들고 클라이언트는 `fileId`만 안다.
- **불변**: 파일을 덮어쓰지 않는다. 새 버전 = 새 파일·새 행. 삭제는 `deleted_at`(소프트 삭제) 후 참조가 없을 때 배치로 지운다.
- **무결성**: 저장 시 `sha256`·`size`를 계산해 둔다. 저장 순서는 "바이트 쓰기 → 메타 행 커밋", 실패하면 바이트를 지운다. 고아 파일은 주기적으로 정리한다.
- **다운로드**: `GET /api/files/{id}/content` 스트리밍, `Content-Disposition`에 원래 이름.
- **OpenWebUI 전달**: 서버가 원본을 읽어 OpenWebUI Files API에 버전 붙인 이름(`이름 (vN).확장자`)으로 올리고 처리 완료를 확인한다. 재사용 ID는 `file_remote_ref(file_id, scope_hash, remote_id)`에 둔다(키·사용자 범위별). 요청 기록에는 그 요청에 쓴 원격 ID를 남긴다(감사용, 캐시와 별개).
- **데모와의 차이**: 데모는 서버가 없어 blob을 IndexedDB 행에 두었다. 화면·도메인 코드는 파일을 `fileId`로 다루므로 이 부분만 서버 API로 바뀐다.

## 5. 요청 기록 (`chat_request`)

데모의 답변 메시지 `requestInfo` → 새 저장소의 요청 테이블.

| 필드 | 의미 |
|---|---|
| `id`, `thread_id`, `reply_message_id`, `user_message_id` | 어떤 질문에 대한 어떤 답변인지 |
| `requested_by`, `retry_of` | 요청자, 다시 시도한 이전 요청 |
| `status` | `pending → streaming → succeeded / failed / cancelled / interrupted` |
| `provider`, `transport`, `model` | Mock/Live, 파일 첨부/본문, 실제 모델 |
| `bytes`, `limit_bytes` | 직렬화한 요청 크기와 당시 한도 |
| `snapshot` (jsonb) | 원본 요청 본문(키 제외). 용량이 크면 파일로 빼고 `storage_key` |
| `chat_request_input` | 항목별: 파일(file_id·버전·★/☑·출처·1회성·전달 방식·원격 ID·오류) 또는 대화(source_task_id·snapshot_id·모드·메시지 수·바이트) |

**진행 중 요청 1건**은 부분 고유 인덱스로 강제한다: `UNIQUE (thread_id) WHERE status IN ('pending','streaming')`. 생존 신호·끊긴 요청 정리는 서버 작업이 맡는다(데모의 `heartbeatAt`·`recoverStaleReplies`에 해당).

## 6. 저장소 함수 ↔ REST (새 저장소의 API 목록 초안)

데모의 `src/db/repositories/*.ts` 함수가 곧 서버 API 목록이다. 새 저장소 프론트는 같은 시그니처의 API 클라이언트로 바꾼다.

| 영역 | 데모 함수 | REST (초안) |
|---|---|---|
| 대화 | `startConversation` | `POST /api/tasks` |
| | `setTaskTitle`, `updateTask` | `PATCH /api/tasks/{id}` |
| | `setTaskStatus` (완료·재개 사유) | `POST /api/tasks/{id}/status` |
| | `deleteTask` (참조 보호) | `DELETE /api/tasks/{id}` → 409 사유 |
| 태그 | `addTag`, `removeTag` | `POST/DELETE /api/tasks/{id}/tags/{tag}` |
| 입력 선택 | `setInput`, `switchInputVersion` | `PUT/DELETE /api/tasks/{id}/inputs/{fileId}` |
| 참조 대화 | `selectConversation`, `applyConversationSummary`, `refreshConversationInput`, `setConversationWeight`, `removeConversationInput`, `loadConversationInputs` | `PUT /api/tasks/{id}/conversation-inputs/{sourceTaskId}` (mode·weight·messageIds·summary) · `POST …/refresh` · `DELETE …` · `GET …` |
| 후보 | (`useTaskData`의 계산) | `GET /api/tasks/{id}/candidates` (파일·대화, 직접 태그 공유) |
| 메시지·요청 | `appendMessage`(팀 의견), `startChat`, `retryChat`, `stopChat` | `POST /api/threads/{id}/messages` · `POST /api/threads/{id}/requests` (SSE로 응답) · `POST /api/requests/{id}/retry` · `POST /api/requests/{id}/cancel` |
| 요청 추정 | `buildChatRequest(dryRun)` | `POST /api/threads/{id}/requests/estimate` |
| 요약 | `summarizeConversation` | `POST /api/tasks/{id}/conversation-inputs/{sourceTaskId}/summary-draft` |
| 파일 | `uploadFile`, `saveAssistantOutput`, `setOutputTag`, `deleteFile`, `fileVersions` | `POST /api/files` (multipart) · `GET /api/files/{id}/content` · `PATCH /api/files/{id}` · `DELETE /api/files/{id}` · `GET /api/files/{id}/versions` |
| SR | `startSrConversation`, `submitSr`, `setSrTitle`, `setSrStatus`, `startTaskFromSr`, `shareSrResult`, `deleteDraftSr` | `/api/service-requests…` 대응 엔드포인트 |
| 에이전트 | `createAssistant`, `updateAssistant`, `setAssistantStatus`, `setAssistantImage`, `reorderAssistants`, `deleteAssistant` | `/api/assistants…` (순서는 revision 충돌 검사) |
| 체크리스트 | `toggleChecklist`, `add/removeChecklistItem`, `saveChecklistReview`, `applyChecklistReview` | `/api/tasks/{id}/checklist…` |
| 기타 | 노트·알림·활동·설정 | `/api/tasks/{id}/notes`, `/api/notifications`, `/api/activity`, `/api/settings` |
| 관리 | `exportAll`, `importAll` | 데모 → 서버 이관 도구(아래 §7). 운영 백업은 DB 백업 |

## 7. 데모 데이터 이관 (선택)

데모에서 쌓은 데이터를 새 저장소로 옮겨야 한다면:

1. 데모 설정 → 데이터 내보내기(JSON, 백업 형식 v3). API 키·원격 캐시는 들어 있지 않다.
2. 이관 도구가 파일의 `blobBase64`를 디코드해 `{root}/{yyyy}/{MM}/{fileId}`에 쓰고 `sha256`을 계산한다.
3. 내장 배열을 자식 테이블로 펼친다(§3). 문자열 ID는 그대로 쓴다.
4. 사용자 ID를 SSO 주체와 매핑한다(데모 사용자는 가상 데이터이므로 보통은 이관하지 않는다).

## 8. 새 저장소에서 정할 것

| 항목 | 권장 | 비고 |
|---|---|---|
| DB | PostgreSQL | 사내 표준 DB가 있으면 그쪽. `jsonb` 사용처(activity payload·request snapshot)만 대체 필요 |
| 서버 | **TypeScript 풀스택 — NestJS + Drizzle** (D20, 2026-09-27) | 데모의 도메인·프롬프트 조립 코드를 서버에서 그대로 재사용. 초안의 Spring Boot는 철회. 상세 [../next-project/architecture.md](../next-project/architecture.md) |
| 파일 저장 | 로컬 디스크·NAS (`FileStorageService`) | S3 호환 저장소로 바꿀 수 있게 인터페이스 유지 |
| 인증·권한 | 사내 SSO(OIDC/SAML 표준, D21), 에이전트 관리·전역 설정은 SO만(D19), 요청자 공개 범위 서버 강제 | 데모는 사용자 전환이 시연용 |
| 실시간 | SSE(응답 스트림) + 필요 시 폴링 | 데모의 탭 간 liveQuery 대체 |
| OpenWebUI | 서버가 대리 호출, 키는 서버 비밀 | CORS 불필요 |
| 정책 | [fusion-design.md](../fusion-design.md) §6 | 추천값대로 확정 (D18, 2026-09-27 — 현업 시험은 이전 버전 시험으로 대신) |
