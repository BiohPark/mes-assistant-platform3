# 잔여 대상 상세 설계 — S3 상세 · S4/S5 개요 (2026-09-28, 개정 1 — **사용자 확정**: "설계 확정, D3 전부 추천안")

> **DB 표현 읽는 법(D40, 2026-10-01)**: 이 문서는 PostgreSQL 기준으로 쓰였다. DB가 MariaDB로 바뀌었으므로 "부분 고유 인덱스"는 저장형 생성 컬럼 + 유일 인덱스, `jsonb`는 `json`, advisory lock은 `db_lock` 행 또는 기존 행 잠금, "마이그레이션 0003"은 초기 마이그레이션에 포함된 것으로 읽는다. 규칙 정본: [db-mariadb-plan.md](db-mariadb-plan.md) §3. 동작·계약은 그대로다.

> 사용자 지시 "승인하고 잔여 대상 상세 설계하자"에 따른 문서. 대응표 잔여 ⬜ 60행(S3 21 · S4 33 · S5·기타 6)을 **API 계약·상태 기계·데이터·화면·테스트** 수준으로 내려 적는다. S3는 코드 착수 직전 수준으로, S4·S5는 결정이 필요한 지점이 드러나는 수준으로. 정본과 어긋나면 정본(PRD·architecture·data-contract·postgres-draft·openapi·fusion-design §5·HANDOFF 결정 D1–D38)이 우선하고, 이 문서는 그 사이를 잇는다. 승인되면 openapi.yaml을 이 문서에 맞춰 갱신하고, 각 태스크의 `sources/*-spec.md`는 이 문서의 절을 가리킨다.
>
> 데모 근거 코드(읽기 전용): `src/app/chatRunner.ts`(+test 12건) · `src/db/repositories/conversationInputs.ts` · `src/llm/{promptBuilder,openwebuiFiles,context,conversationSummary}.ts`(S0 이식 완료) · `src/features/chat/{useChat,useRequestEstimate,ContextTray,MessageBubble,RequestInfoDialog}.tsx` · `src/features/task/{ConversationInputs,ConversationPickerDialog}.tsx`.

## 0. 공통 불변식 (S3 전체가 지킨다)

| # | 불변식 | 강제 위치 |
|---|---|---|
| I1 | **provider 호출은 서버 RequestService만** — 주 요청(`POST /api/threads/{id}/requests`·retry)과 **보조 호출**(AI 제목·요약 초안, §8.9) 모두. 웹은 시작·중지·재시도를 요청하고 결과를 본다 | RequestService 밖에서 `createProvider`를 부르는 코드 없음(lint 규칙 또는 테스트로 단언) |
| I2 | **대화당 진행 중 요청 1건** | `chat_request_one_active` 부분 고유 인덱스 + 트랜잭션 안 삽입 → 충돌 시 409 |
| I3 | **보낸 것 = 본 것**: 트레이 추정과 실제 전송은 같은 `buildChatRequest` | 추정 API가 `dryRun: true`로 같은 함수 호출. 단위 테스트로 `info` 동일성 단언 |
| I4 | **자동 절단·자동 요약·자동 재전송 없음**. 한도 초과는 전송 차단, 실패는 사람이 재시도 | 서버가 `bytes > limit` → 요청 실패 기록·provider 미호출. 재시도는 사람이 `POST /requests/{id}/retry` |
| I5 | **파일 전달 실패는 요청 중단 + 항목별 표시**(D17) | `failed` 상태 + `chat_request_input.delivery='failed'`·`error` |
| I6 | **참조 대화는 같은 태그를 직접 공유하는 대화만, 자신의 메시지만**(D6·D15·fusion §5.4) | 후보 API·PUT 검증·promptBuilder 배치 |
| I7 | **늦은 쓰기 차단**: 답변 자리표시가 이미 닫혔으면(중지·정리) 덮어쓰지 않는다 | `update message where status='streaming'` 조건부 갱신(fenced update) |
| I8 | 업무 절차 프롬프트 없음(FR-36·D9) | promptBuilder 이식분 유지, system은 플랫폼 컨텍스트·주입 방지만 |
| I9 | 키·원격 ID는 응답·스냅샷·로그에 없음 | 스냅샷은 `keys 제외` 직렬화, `remote_id`는 감사 컬럼만 |

---

## 1. S3 ① `s3-request` — 요청 서비스

### 1.1 데이터

- `chat_request`(초안 DDL 그대로): `status ∈ pending·streaming·succeeded·failed·cancelled·interrupted`, `provider`, `transport(inline|openwebui)`, `model`, `bytes`, `limit_bytes`, `error`, `snapshot jsonb`, `lease_until`, `retry_of`, `user_message_id`, `reply_message_id`(unique).
- `chat_request_input`: 항목별 `kind(file|conversation)`·`weight`·파일(`file_id`·`file_version`·`source_label`·`one_shot`·`delivery`·`remote_id`·`error`) / 대화(`source_task_id`·`snapshot_id`·`mode`·`message_count`·`bytes`).
- `message`: 답변 자리표시는 `role=assistant, status=streaming, content=''` → 종료 시 `done|error`. 데모의 `heartbeatAt`·`requestInfo`·`requestSnapshot`은 **메시지 대신 `chat_request`가 가진다**(data-contract §5). 답변 메시지 ↔ 요청은 `reply_message_id`.
- `file_remote_ref(file_id, scope_hash, remote_id)`: OpenWebUI 업로드 재사용 캐시. `scope_hash = sha256(baseUrl + '#' + shortHash(apiKey))` — 서버·키가 바뀌면 다시 올림(데모 `remoteKey` 규칙).
- **스냅샷 저장(S3-4a)**: 직렬화 크기 ≤ 1 MiB면 `snapshot` jsonb, 초과면 `FileStorageService`에 `requests/{yyyy}/{mm}/{requestId}.json`으로 쓰고 `snapshot = {"storageKey": "..."}`. 조회 API가 둘을 구분해 같은 형태로 준다.
- 테이블·부분 고유 인덱스는 S0 마이그레이션 0000에 이미 있다(Orchestrator 대조 2026-09-28). **마이그레이션 0003(개정 1)**: `chat_request.idempotency_key text`(§8.1) + `unique (thread_id, idempotency_key)`, `chat_request.phase text`(§8.7). 초안 SQL 동기화.

### 1.2 상태 기계

```
              acquire(tx)                build+deliver            stream           finalize
POST → [pending] ──────────► (파일 전달·조립) ──► [streaming] ──► [succeeded]
              │                    │  전달 실패 / 한도 초과              │  중지(cancel)   → [cancelled]  (부분 응답 보존)
              │                    └─────────────► [failed]             │  시간 초과      → [failed]     error='응답 시간 초과 …'
              │ 409(활성 있음·완료 대화) / 413(한도) 는 요청 행 없이 거부   │  provider error → [failed]
              └── lease 만료(서버 죽음·끊김) → 정리 작업 → [interrupted]  (자동 재전송 없음)
```

- 메시지 상태 매핑: `pending·streaming → message.status='streaming'`, `succeeded → done`, `failed·cancelled·interrupted → error`(`error` 문구는 요청의 `error`). 취소·중단은 **부분 응답 `content`를 보존**한다(데모 규칙).
- `pending`은 조립·파일 전달 단계(첫 토큰 전). 웹은 `phase` 문구로 표시.

### 1.3 API 계약 (openapi 반영 대상)

**`POST /api/threads/{threadId}/requests`** body `{ content, attachmentIds?: string[], oneShotFileIds?: string[] }`

검증 순서(모두 한 트랜잭션): 스레드→task 존재, `task.status='done'` → 409 `TASK_DONE`; `chat_request_one_active` 충돌 → 409 `REQUEST_ACTIVE`; 첨부 개수 > `FILE_MAX_PER_REQUEST` → 413; `attachmentIds`는 이 대화의 활성 파일이어야(400). 첨부 중 `oneShotFileIds`에 없는 것은 **☑ 참고 입력으로 고정**(`task_input` upsert, 데모 `useChat.send` 규칙). 사용자 메시지(`role=user, kind=null`) + `message_attachment` + 답변 자리표시 + `chat_request(pending, lease_until=now+30s)` 생성, activity `message.sent`. **응답은 SSE**(`text/event-stream`):

| event | data | 시점 |
|---|---|---|
| `started` | `{ requestId, replyMessageId, userMessageId }` | 트랜잭션 커밋 직후 |
| `phase` | `{ text }` 예 `파일 올리는 중 1/3 · a.pdf` | 파일 전달 진행 |
| `delta` | `{ text }` | 토큰 조각(서버는 250 ms마다 DB flush) |
| `completed` | `{ requestInfo }`(RequestInfo, 키 없음) | succeeded |
| `failed` | `{ error, requestInfo? }` — `requestInfo.inputs[].delivery='failed'`로 항목별 실패 | failed·cancelled·interrupted·timeout |

클라이언트 연결이 끊겨도 **서버 작업은 계속**(I1) — 응답 스트림은 뷰일 뿐. 재접속한 탭은 `GET /api/threads/{id}/messages`로 `streaming` 자리표시를 보고 `GET /api/requests/{id}`(status·phase)를 폴링하거나 `/api/events`(③)로 갱신을 받는다.

**`POST /api/requests/{requestId}/cancel`** → 204. 같은 프로세스가 실행 중이면 `AbortController.abort('cancelled')`; 아니면(재시작 뒤 잔존) 요청을 `cancelled`·메시지 `error('요청을 중지했습니다.')`로 닫는다(fenced). 이미 끝났으면 204 멱등.

**`POST /api/requests/{requestId}/retry`** body `{ excludeFileIds?, forceInlineFileIds? }` → SSE(시작과 같음). 규칙(데모 `retryChat`): 대상 요청이 `failed|interrupted|cancelled`이고 **그 답변이 스레드의 마지막 비-팀의견 메시지**여야(아니면 409 `NOT_LATEST`); 새 사용자 메시지를 만들지 않고 같은 `user_message_id`로 새 `chat_request(retry_of=원 요청)`; `excludeFileIds`는 `task_input`에서 해제(setInput null); `oneShot` 재계산 = 원 메시지 첨부 중 제외되지 않았고 입력에 없는 것; `forceInlineFileIds`는 텍스트 파일만(아니면 400).

**`GET /api/requests/{requestId}`** → `RequestRecord { id, threadId, status, provider, transport, model, bytes, limitBytes, error?, retryOf?, createdAt, finishedAt?, inputs: RequestInputRecord[] }`. **`GET /api/requests/{requestId}/snapshot`** → 원본 요청 JSON(jsonb 또는 파일에서, 키 없음), `Content-Disposition: attachment; filename="request-{id}.json"`.

**`GET /api/threads/{threadId}/messages`** 응답 `Message`에 `requestId?`(답변이면)·`status`·`kind`·`attachmentIds` 포함 — 웹이 "사용한 자료" 버튼과 재시도 버튼을 그릴 근거.

오류 코드: 404(스레드·요청 없음) · 409 `TASK_DONE`·`REQUEST_ACTIVE`·`NOT_LATEST`·`NOT_FAILED` · 413 `ATTACHMENT_LIMIT`·`REQUEST_TOO_LARGE`(한도 초과는 요청 행을 `failed`로 남기고 SSE `failed`로도 알림 — 데모 규칙 유지: "기록에 남는 실패") · 400 입력 검증.

### 1.4 실행 흐름 (서버 작업)

1. **acquire**(트랜잭션, 위 검증) → `started` 전송.
2. **build**: `history` = 스레드 메시지 중 `createdAt ≤ 사용자 메시지`(팀 의견 포함 — promptBuilder가 `kind=discussion` 제외 처리는 데모 그대로) → `buildChatRequest(scope, thread, history, { oneShotFileIds, forceInlineFileIds, signal, onProgress }, ports)`. `ports = DbLlmPorts`(S1 어댑터 완성: `loadConversationInputs`는 ②까지 빈 배열, `readFileBytes`는 `FileStorageService.read`, `updateFileRemoteIds`는 `file_remote_ref` upsert, `getFilesBySr`·`getServiceRequestsByCodes`는 S4).
3. **전달 실패** `built.failed.length > 0` → `chat_request.status='failed'`, `error='파일 N개(…)를 OpenWebUI에 전달하지 못해 요청을 보내지 않았습니다. …'`, inputs에 `delivery='failed'`; provider **미호출**. **한도 초과** `info.bytes > info.limitBytes` → `failed`, `error='요청 크기 한도 초과 (… KB / … KB) …'`.
4. **stream**: `provider.stream({ model, messages, files, meta, signal })`. 첫 토큰 타이머 `files ? filesFirstTokenMs : firstTokenMs`, 토큰마다 `idleMs` 재무장. 델타는 메모리 누적 + `flushMs`(250)마다 fenced update(`content`, `lease_until=now+30s`) — 실패(=다른 곳이 닫음)면 `abort('lost')`.
5. **finalize**(`finally`): `lost`가 아니면 fenced update로 `content=acc || '⚠️ '+error`, `status`, `error`, `finished_at`; `chat_request` 상태·`snapshot`·`bytes`; SSE `completed|failed`; 연결 닫기. 성공이고 `title_source='default'`면 **첫 답변 뒤 1회 AI 제목**(`suggestTitle`, 실패 시 규칙 제목, `title_source='ai'`) — 수동 제목은 건드리지 않음(FR-03).
6. 활동 이력: `request.started`·`request.failed`·`request.completed`·`request.cancelled` (payload에 requestId·bytes·model, 키 없음).

### 1.5 시간 제한·생존 신호·정리 (S3-2a·S3-3a)

| 설정 | 기본 | 근거 |
|---|---|---|
| `REQUEST_FIRST_TOKEN_MS` | 60 000 | FR-33 |
| `REQUEST_FILES_FIRST_TOKEN_MS` | 360 000 | FR-33 (OpenWebUI 파일 처리 대기 포함) |
| `REQUEST_IDLE_MS` | 60 000 | FR-33 토큰 사이 |
| `REQUEST_LEASE_MS` | 30 000 | 생존 신호 간격 10 s(`REQUEST_KEEPALIVE_MS`)의 3배 |
| `REQUEST_SWEEP_MS` | 30 000 | 정리 작업 주기 |
| `REQUEST_BUDGET_BYTES` | 262 144 (256 KiB) | fusion §5.8·D18. `app_setting.request_budget_bytes`가 있으면 그 값(SO 설정은 S4) |

- 정리 작업(api 프로세스 `setInterval`, 기동 시 1회 즉시): `status in (pending, streaming) and lease_until < now()` → `interrupted`, 메시지 `error='응답이 중단되었습니다 — 요청한 화면이 닫혔거나 연결이 끊겼습니다. 자동으로 다시 보내지 않았습니다.'`(데모 `STALE_ERROR`), 부분 응답 보존. 자기 프로세스가 아직 실행 중인 요청은 lease가 살아 있으므로 건드리지 않는다.
- 프로세스 재시작 = 진행 중이던 요청은 기동 시 정리로 `interrupted`(PRD §6 가용성 "재시작 시 진행 중 요청은 중단으로 정리").
- 다중 인스턴스는 S5 결정(그때는 lease 갱신을 인스턴스 id와 함께).

### 1.6 OpenWebUI 파일 전달 (S3-5a)

- 서버에서 `deliverFiles(settings, files, { signal, onProgress, pollMs: 2000, processTimeoutMs: 300000 }, ports)`(이식 완료). 순서: **주 입력 먼저**(★) → 참고, 업로드 이름은 `versionedName(name, version)` 예 `URS_DEMO (v2).md`(FR-32·E1 S5). 업로드 성공 시 `file_remote_ref` 저장, 다음 요청은 재사용(처리 상태만 확인).
- `LLM_PRESET=openai-compatible`면 Files API를 쓰지 않고(`usesFilesApi=false`) 텍스트 파일은 본문 인라인, 그 외는 `metadata_only`(이름만) — 트레이 배지로 드러남(I3).
- **가짜 OpenWebUI 확장**(compose `server.mjs`) — 이식된 클라이언트 `openwebuiFiles.ts`가 실제로 부르는 경로에 맞춘다(Orchestrator 대조 2026-09-28): `POST /api/v1/files/`(multipart → `{ id, filename, meta:{size} }`) · **`GET /api/v1/files/{id}/process/status` → `{ status: 'pending'|'completed'|'failed' }`**(업로드 뒤 1.5 s 후 `completed`; 404는 클라이언트가 "처리 확인 미지원"으로 통과시키므로 가짜는 반드시 구현) · 이름이 `fail-*`면 upload 500, `stuck-*`면 영원히 `pending`(processTimeoutMs 검증), `slow-*`면 8 s 뒤 `completed` · `chat/completions`는 `files` 파라미터를 받아 응답 본문에 `[files: n]`을 넣어 E2E가 전달 여부를 확인. 실제 사내 형태와 다르면 **어댑터(openwebuiFiles.ts)만** 맞춘다(D31 위험 — HANDOFF §7 함정에 기록).

### 1.7 Mock provider (S3-8a)

`LLM_MODE=mock`이면 `MockProvider`(이식 완료)·`mockScenarios`: 응답에 "사용한 자료" 블록(등급·버전)을 드러내(E1 S8) 규칙적으로 검증 가능. 파일 전달은 mock에서도 `transport=inline`으로 기록(Files API 없음). E2E는 기본 mock, **파일 전달 시나리오(S5·E2)만 `LLM_MODE=live` + 가짜 OpenWebUI**로 별도 compose 프로필(`e2e-live`) 또는 테스트 내 환경 변수 전환.

### 1.8 웹

- `useChat` 재작성: `send(text, attachmentIds, oneShotFileIds)` → `fetch POST … requests`를 **ReadableStream reader로 SSE 파싱**(EventSource는 POST 불가) → 로컬 상태 `run { replyId, text, phase }`; `stop()` → cancel API; `retry(failedReplyId, opts)` → retry API(SSE). 다른 PC·탭의 진행은 `messages`의 `status='streaming'`(+ ③ 이벤트)로 `remoteStreaming`. 첨부 고정 규칙은 서버가 하므로 클라이언트에서 `setInput` 호출 제거.
- `Composer`: AI 전송 버튼 활성(S2에서 숨김 해제). 한도 초과·활성 요청 중이면 비활성(③ 추정 결과 사용).
- `MessageBubble`: 실패 답변에 [다시 시도] [파일 빼고 다시(항목 선택)] [텍스트로 보내기(텍스트 파일만)] — `requestInfo.inputs` 기반(데모 그대로). "사용한 자료" → `RequestInfoDialog`(`GET /api/requests/{id}`, 원본 JSON 다운로드는 `/snapshot`).
- `requestLabels.ts` 이식(전달 방식·상태 라벨).

### 1.9 테스트 매핑

| 데모 `chatRunner.test.ts`(`it` 11건) + E5 보호 | 서버 테스트(vitest, tempDb + 가짜 provider 주입) |
|---|---|
| stores the user message and a reply with the structured request record | 요청 1건: user·reply 메시지, chat_request(succeeded)·inputs 기록, snapshot 키 없음 |
| keeps the live run state until the final reply is stored | finalize 순서: DB 먼저 → 메모리 run 제거(동시 전송 요청이 409를 받는 창 없음) |
| allows only one active request per conversation, even when two start at once | 두 요청 `Promise.all` → 하나 201·하나 409(인덱스 충돌 → 409 변환) |
| a failure while building the request ends as an error | ports가 throw → `failed`·메시지 error·입력창 풀림(웹 테스트) |
| times out when no first token arrives | provider가 안 보내면 `firstTokenMs` 후 failed('응답 시간 초과') |
| refuses to start on a completed conversation, and completion is refused while a reply is running | 완료 대화 409 · 활성 요청 중 `POST /tasks/{id}/status done` 409 |
| local stop keeps the partial text and marks the reply as stopped | cancel → cancelled, content 보존 |
| a reply resolved elsewhere is not overwritten by the late runner | 다른 경로가 먼저 닫음 → fenced update 실패 → 늦은 쓰기 없음 |
| recovers replies whose heartbeat stopped, and leaves live ones alone | sweeper: lease 만료만 interrupted |
| stops before calling the model when a file cannot be delivered; retry as text sends it once | 전달 실패 → provider 미호출·failed; retry forceInline → 1회 전송 |
| retry can exclude a file and only works on the latest failed reply | exclude → task_input 해제; 마지막이 아니면 409 |
| E5 백업에 키·원격 ID 없음 | snapshot·RequestRecord 직렬화에 `apiKey`·`remote_id` 미포함 단언 |

E2E: E1 **S5**(가짜 OpenWebUI live: 처리 완료 후 전송·주 입력 먼저·버전 이름) · **S6**(조립 실패 → 입력창 풀림) · **S7**(두 탭 동시 → 1건) · **S8**(Mock 사용한 자료 표시) · **E2**(전달 실패 → 요청 안 보냄 → 텍스트로 보내기 복구).

---

## 2. S3 ② `s3-context` — 참조 대화

### 2.1 후보 (`GET /api/tasks/{id}/candidates` 의 `conversations`)

- 조건: 현재 대화와 `tag_key`를 하나 이상 **직접** 공유 · 자기 자신 제외 · **SR 접수 스레드 제외**(fusion §5.1) · 상태 무관(완료 대화도 후보 — 데모 `conversationCandidates` 규칙 확인 후 동일하게). 정렬 `last_activity_at desc`.
- 항목: `{ taskId, code, title, status, assistant:{id,name,color}, sharedTags[], messageCount(적격), bytes(적격 원문 합), lastActivityAt, selected?: { weight, mode, snapshotId, newMessages, detached } }`. 적격 메시지 = `role in (user, assistant) and status='done' and kind is null and trim(content) <> ''`(팀 의견·실패·미완성·**빈 본문(첨부만)** 제외 — domain `eligibleMessages`와 동일).
- 태그는 발견 조건이지 권한이 아니다 — S2-9로 로그인 사용자 전원 열람이라 S3에선 추가 검사 없음(S4 BO 제한 때 재검토).

### 2.2 데이터

`conversation_input(id, task_id, source_task_id unique 쌍, weight, mode, snapshot_id, selected_by, selected_at)` · `context_snapshot(id, source_task_id, mode, up_to_message_id, summary_text/source/model, created_by, created_at)` · `context_snapshot_message(snapshot_id, message_id, seq)`. 스냅샷은 **불변**, 갱신은 새 행(옛 스냅샷은 요청 기록이 가리킬 수 있어 보존). DDL 변경 없음. 도메인 `ContextSnapshot.upToCreatedAt`(`newMessagesSince` 폴백)은 DDL에 없으므로 `up_to_message_id`의 메시지 `created_at`에서 **파생**해 채운다(경계 메시지가 삭제된 대화는 `newMessagesSince`가 createdAt 폴백으로 계산). 후보 규칙은 이식된 `conversationCandidates`(상태 무관·직접 태그·최근 활동순)를 서버 SQL로 옮긴 것과 같아야 한다(단위 테스트로 동일성).

### 2.3 API

- `GET /api/tasks/{id}/conversation-inputs` → `LoadedConversationInput[]`(선택 순): `{ input, snapshot:{id,mode,upToMessageId,summaryText?,…}, source:{taskId,code,title,assistant}, messageCount, newMessages, detached, bytes }`. `messages` 원문은 크기 때문에 넣지 않고 미리보기는 `GET /api/threads/{id}/messages?ids=`로.
- `PUT /api/tasks/{id}/conversation-inputs/{sourceTaskId}` body `{ mode: 'full'|'messages'|'summary', weight?, messageIds?, summary?: { text, source:'ai'|'rule', model?, messageIds } }` — 검증: 자기 참조 400, 완료 대화 409, `full·messages`는 직접 태그 공유 필수(409), `summary`는 기존 선택이 있으면 태그 검사 생략(데모), `messages`는 1개 이상(400), `full`은 적격 0건이면 400. 트랜잭션: 스냅샷 insert + 입력 upsert + activity(`context.selected|refreshed`). 응답 `LoadedConversationInput`.
- `PATCH …/{sourceTaskId}` `{ weight }` → 204 · `DELETE …` → 204(스냅샷 보존) · `POST …/refresh` → full 모드만(400 아니면), 새 스냅샷 · `POST …/summary-draft` `{ messageIds? }` → `{ text, source, model }`: mock이면 규칙 요약(`conversationSummary.ts` 규칙 경로, source `rule`), live면 보조 요청(작은 프롬프트, 요청 기록에 남기지 않음 — **AI 요청 1건 규칙과 별개**의 보조 호출이지만 동시 1건 제한은 스레드 단위가 아니라 사용자 단위 rate로 완만히), 원문 바이트 > `REQUEST_BUDGET_BYTES` → 413.
- 삭제 보호: `DELETE /api/tasks/{id}`는 `conversation_input.source_task_id = id`가 있으면 409(`REFERENCED`), `context_snapshot`이 `chat_request_input`에 쓰였으면 409(기록 보존).
- `POST /api/tasks`의 `referenceTaskId`(S2 보류분) → 생성 트랜잭션에서 `full`·`main` 선택 시도, 태그 미공유면 조용히 무시하지 않고 **응답 `warnings[]`**에 넣는다.

### 2.4 프롬프트 배치·LlmPorts

`DbLlmPorts.loadConversationInputs(taskId)` 완성 → promptBuilder(이식분)가 `## 참조 대화 (N)` 절에 `### [주 입력|참고] WK-… · 에이전트 · "제목" — 메시지 12개 · 선택 시점 …` + `[사용자 · 이름] …`/`[assistant] …` 인라인(fusion §5.5). 요청 기록 `chat_request_input(kind=conversation, snapshot_id, mode, message_count, bytes)`.

### 2.5 웹

자료함 "대화" 섹션(`ConversationInputs`: 행 = 에이전트 칩·코드·제목·상태·공유 태그·메시지 수·크기·"새 메시지 N · 갱신"·"태그 해제됨", ☑/★·×) · `ConversationPickerDialog`(모드 3종, 메시지 목록·범위, 전달 미리보기·크기, 요약 초안 → 편집 → 적용; 좁은 화면 전체 시트) · `useTaskData` 후보·원문 규모 완성 · 초안 `?ref=` 선택 표시.

### 2.6 테스트

데모 `conversationInputs.test.ts` → DB 테스트(같은 시나리오): 직접 공유만·간접 제외, full/messages 스냅샷 ID 고정, 요약 적용, refresh는 full만, 태그 해제 후 선택 유지(detached), 삭제 보호. E2E **E3a**(같은 태그만 후보·통째로 → 전체 원문, 팀 의견 제외) **E3b**(메시지 범위) **E3c**(요약은 누를 때만·수정본 전달) **E3d**(선택 시점 고정·갱신 필요 표시).

---

## 3. S3 ③ `s3-tray-events` — 추정 · 이벤트 · presence

### 3.1 추정 (`POST /api/threads/{threadId}/requests/estimate`)

body `{ draft?: string, attachmentIds?: string[], oneShotFileIds?: string[] }`(개정 1: 아직 고정되지 않은 초안 첨부 포함) → `RequestInfo & { overLimit: boolean, limitBytes, attachmentLimit }`. 구현은 **①의 조립 함수에 `dryRun: true`** — 실제 전송과 **같은 입력 상태**(초안 첨부는 전송 시 규칙대로 ☑ 고정될 것으로 가정)를 조립. 동일성 계약은 §8.5. 로그인 사용자, 완료 대화도 조회 가능(전송만 차단). 클라이언트 `useRequestEstimate`: 400 ms 디바운스, 키 = 초안·입력 선택·참조 대화·메시지·설정 변경.

### 3.2 한도 초과 UX (fusion §5.8)

`ContextTray`(컴포저 위): "이번 요청에 사용 · N" 칩(파일·대화, ★/☑ 전환, ×, 전달 방식 배지 첨부/본문/이름만), 게이지 `예상 180 KB / 256 KB`. 초과면 전송 버튼 비활성 + 안내: [입력 해제] [메시지 범위 선택] [요약 만들기] [새 대화로 이어가기(이 대화를 참조로 선택)]. 자동 절단·자동 요약 없음(I4). E2E **E4**.

### 3.3 이벤트 채널 (`GET /api/events`, S3-1a)

- 인증: 세션 쿠키(EventSource 가능). 서버 메모리 브로드캐스터(단일 인스턴스, S5에서 재검토). 하트비트 `: ping` 15 s. `Last-Event-ID` 재접속 시 최근 5분 링 버퍼 재전송(없으면 클라이언트가 전체 무효화).
- 이벤트(모두 로그인 사용자 전원에게 — S2-9 열람 범위. BO 제한은 S4에서 필터 추가): `task.updated {taskId}` · `task.created {taskId, assistantId}` · `message.appended {threadId, taskId, messageId}` · `request.updated {requestId, threadId, taskId, status, phase?}`(델타 없음 — 요청한 탭만 SSE 응답으로 받음) · `file.updated {taskId}` · `input.updated {taskId}` · `context.updated {taskId}` · `presence.typing {threadId, userId, name, until}`(휘발성, DB 없음) · `notification.created`(S4).
- 웹 `useEvents()`: 이벤트 → TanStack `invalidateQueries` 매핑 표(`task.updated`→['task',id],['tasks'] …). 다른 PC의 응답 진행은 `request.updated`로 "응답 중…"·phase 표시, 완료 시 메시지 재조회. 칸반·대화 화면·자료함이 PC 간 실시간 반영(FR-04).

### 3.4 presence (U5a)

`POST /api/threads/{id}/typing` → 204, 서버가 `presence.typing`(until = now+5 s) 브로드캐스트. 클라이언트는 입력 중 3 s마다 한 번. 표시는 `ChatView` 상단 "○○ 입력 중…". 저장 없음.

### 3.5 요청 기록 뷰어 (E6)

`RequestInfoDialog`: 답변의 "사용한 자료"에서 열림 — `GET /api/requests/{id}`(항목별 전달 방식·크기·실패 사유·모델·retryOf) + [원본 JSON 다운로드](`/snapshot`). 키·원격 ID 없음 단언(단위).

### 3.6 테스트

단위: 추정 `info` == 실제 요청 `info`(같은 입력) · 이벤트 매핑 · 링 버퍼 재전송 · presence TTL. E2E **E4**·**E6** + "다른 사용자 브라우저에서 팀 의견이 실시간 표시"(FR-04).

---

## 4. S4 개요 (대응표 33행) — 태스크 후보와 결정 지점

| 태스크 후보 | 범위(대응표 행) | 설계 요지 | 결정 필요 |
|---|---|---|---|
| `s4-admin` | `/assistants/manage`·`ManagePage`·`AssistantTable`·`AssistantEditorSheet`·`ImageDropzone`·`SortableAssistantGrid`(편집)·`assistants.ts` 쓰기 API·`/settings`·`SettingsPage`·`settings.ts`·코드 관리 화면·API·SO/BO 지정·계정 관리(KI-5) | SO 전용 서버 강제(D19). `PUT /assistants/order`는 `revision` 충돌 409. 전역 설정 `app_setting`(기본 모델·파일 전달 방식·요청 한도·SR 접수 에이전트·**링크1 기본 규칙 U9**). 코드 관리: `code_group`·`code` CRUD(비활성화만, 삭제 금지 — 참조 무결성) | S4-1 비밀번호 변경·재설정 방식(SO가 임시 비밀번호 발급?) · S4-2 코드 그룹 추가 허용 범위(사용자가 새 그룹을 만들 수 있나) · S4-3 에이전트 이미지 저장(file_object kind `assistant_image`) 공개 범위 |
| `s4-sr` | `/sr`·`/sr/manage`·`sr/*` 7행·`sr.ts`·E1 S2 | 요청자(BO) 범위 서버 강제: BO는 자기 SR·공유 결과만(`@Roles('requester')` + 소유 검사). 접수 전환은 AI 제목(보조 요청), SR 코드 `SR-YYYY-NNNN` 발급, 연결 업무 시작(이어가기 우선), 결과 공유(텍스트+산출물 → 요청자 열람 허용 목록) | S4-4 BO가 볼 수 있는 파일 범위(공유 결과의 산출물만? 첨부도?) · S4-5 SR 접수 스레드도 RequestService 사용(scope `sr`) — ①에서 `ChatScope.sr` 경로를 열어 둘지(권장: 열어 두고 S4에서 화면만) |
| `s4-task-extras` | `ChecklistPanel`·`ChecklistReviewCard`·`NotesPanel`·`TaskCompleteDialog`·`ActivityPanel` 잔여·`tasks.ts` 체크리스트 함수·`notes.ts` | 체크리스트: 에이전트 템플릿 → 대화 복사, AI 달성도 m/n(보조 요청, `checklistReview.ts` 이식분), 강제 없음. 완료 절차: 리포트 저장(`task_report`)·입력 출처·피드백 | S4-6 완료 리포트 형식(데모 `taskReport.ts` 그대로?) · S4-7 노트 첨부 파일의 kind |
| `s4-notify-reports` | `NotificationBell`·`notifications.ts`·`/reports`·`ReportsPage`·`charts` | 알림: 서버 생성(`notification` 테이블) + `/api/events notification.created` + 읽음 처리. 리포트: 서버 집계 API(완료 이벤트 시각 기준 FR-62) | S4-8 알림 발생 조건 목록(데모 `notify` 호출 지점 그대로?) · S4-9 리포트 기간·집계 정의 확정 |
| `s4-system-assistant` (U1) | `SystemAssistantDrawer`·`actions.ts`·`tools.ts`·`mockSystemAssistant.ts` | 서버 대리 호출, 도구 3종(대화 시작·에이전트 등록·태그 추가)은 **제안 카드 → 사용자 확인 → 기존 API 호출**(권한 그대로) | S4-10 live 모델에 도구 정의를 보낼지(function calling) vs 규칙 기반 대역만 |

## 5. S5 개요 (대응표 S5 1행 + 비기능·배포)

- 비기능(PRD §6) 값 확정 → 설정 기본값 갱신, 부하 확인(동시 스트림 20), 보관·감사(추가만) 점검, 로그 마스킹.
- 배포: **Windows 서비스 네이티브 vs 컨테이너** 결정(D22 유예). SSE는 리버스 프록시 버퍼링·타임아웃 설정 필요(KI에 기록). 다중 인스턴스면 이벤트 브로드캐스터·lease를 DB/Redis 기반으로.
- 이관 도구(U7a): 데모 JSON `importAll` → 서버 API/스크립트(가상 데이터 검증 포함).
- 회사 PC 수신 방법(G7)·Windows 실기(KI-6)·OpenAI 실키(S1 이월).

## 6. 사용자 결정 요청 (이 문서 승인 시 함께)

| # | 항목 | 추천 |
|---|---|---|
| D3-1 | ①에서 `ChatScope.sr`(SR 접수 스레드) 경로를 열어 두기(S4-5) | 열어 둔다 — RequestService를 두 번 만들지 않음 |
| D3-2 | `summary-draft`(요약 보조 요청)를 요청 기록에 남길지 | 남기지 않음(스냅샷에 요약 본문·모델·출처만) — 데모와 같음 |
| D3-3 | 스냅샷 파일 전환 임계 1 MiB | 그대로 |
| D3-4 | `/api/events` 링 버퍼 5분·하트비트 15 s | 그대로 |
| D3-5 | 완료 대화에서 추정 API 허용(조회만) | 허용 |
| S4-1~10 | 위 §4 표 | S4 착수 계획서에서 다시 선택지로 |

## 7. 대응표 S3 21행 → 태스크 매핑

①: §4 `ChatView`(스트리밍) · `Composer`(AI 전송) · `MessageBubble` · `RequestInfoDialog` · `requestLabels.ts` · `useChat.ts` · §5 `chat.ts` 잔여(활성 응답·정리) · §9 S5·S6·S7·S8·E2·E5 · `support/app.ts`(로그인 헬퍼 정리). ②: §3 `ConversationInputs`·`ConversationPickerDialog`·`useTaskData` 잔여 · §5 `conversationInputs.ts`(+test) · §9 E3a–d. ③: §2 `presence.ts` · §4 `ContextTray`·`useRequestEstimate` · §9 E4·E6 · FR-04 실시간(대응표 `/` 칸반 행 실시간 보완).


---

## 8. 개정 1 — codex-critic 설계 리뷰(2026-09-28) 반영

리뷰 원문: `tasks/s3-request/workers/codex-critic/result-design.md`. 아래가 위 절과 어긋나면 **이 절이 우선**한다.

### 8.1 멱등 키 (높음)
- `POST …/requests`·`POST /requests/{id}/retry`는 헤더 `Idempotency-Key`(클라이언트가 전송 시도마다 UUID 생성, 재접속·재전송에는 같은 키) **필수**(없으면 400). 저장: `chat_request.idempotency_key`, `unique (thread_id, idempotency_key)`(마이그레이션 0003).
- 같은 키 재호출: 기존 요청을 찾아 **새 행을 만들지 않고** SSE로 `started`(같은 requestId) + 현재 상태(진행 중이면 이후 델타를 이어서, 끝났으면 `completed|failed` 즉시)를 보낸다. 다른 키 + 활성 요청 있음 → 409 `REQUEST_ACTIVE`(기존과 같음).
- HANDOFF §7 이월 항목(초안 생성 idempotency)은 S3에서 `POST /api/tasks`에도 같은 헤더를 선택 적용(있으면 `task.idempotency_key` — 0003에 함께; 없으면 기존 동작).

### 8.2 종료 전이의 원자성 (높음)
- 종료(성공·실패·취소·중단·시간 초과)는 모두 **한 트랜잭션의 조건부 전이**: `update chat_request set status=$to, error, finished_at, bytes, snapshot where id=$id and status in ('pending','streaming')` + 같은 tx에서 답변 메시지 `update … where id=$reply and status='streaming'`. 갱신 행 수가 0이면 다른 경로가 먼저 닫은 것 — **아무것도 쓰지 않고 최종 SSE도 보내지 않는다**(전이 성공자만 `completed|failed` 발신). 이것이 I7의 정의다.
- 취소 API: 먼저 위 전이(`cancelled`)를 수행하고 성공했을 때만 실행기에 `abort('cancelled')`. 실행기는 abort를 받으면 스트림을 끊고 finalize에서 전이를 시도하지만 0행이라 건너뛴다(부분 응답은 취소 전이가 `content=현재까지`로 함께 기록 — 실행기가 마지막 flush 이후 받은 글자는 버려도 됨을 명시).
- sweeper: `update … set status='interrupted' where status in (pending,streaming) and lease_until < now()` + 메시지 전이, 같은 규칙. 실행기 flush(`content`·`lease_until` 갱신)도 `where status='streaming'` 조건부 — 0행이면 `abort('lost')`.
- 잠금 순서(교착 방지): **task 행 → thread → chat_request** 순으로만 잠근다(acquire·완료 전이·취소·삭제 공통).

### 8.3 응답 중 완료 거부 (높음)
- `tasks.service.setStatus(done)`: 트랜잭션에서 task `for update` → `exists chat_request where thread=… and status in (pending,streaming)` → 409 `REQUEST_ACTIVE`. acquire도 task `for update` 후 인덱스 삽입 → 두 경로가 같은 잠금을 공유해 경쟁이 직렬화된다. **S2 서비스 변경이 ① 범위**(request-spec §구현 순서 4).

### 8.4 LlmPorts SR 포트 (높음)
- `getServiceRequestsByCodes(codes)`·`getFilesBySr(srId)`는 S3에서 **실제 DB 조회로 구현**(`service_request`·`file_object(kind=sr_attachment)` 테이블은 0000에 존재; S4 전엔 빈 결과). NotImplemented 던지기 금지 — SR 태그가 붙은 일반 업무 요청이 promptBuilder에서 이 포트를 호출한다.
- `ChatScope.sr`(SR 접수 스레드) 경로도 열어 둔다(D3-1 추천). 화면은 S4.

### 8.5 추정 ↔ 전송 동일성 계약 (높음)
- 비교 대상 = `RequestInfo`에서 **실행 시점에만 확정되는 필드를 제외한 부분**: `provider, transport, model, limitBytes, bytes, srCodes, inputs[].{kind, weight, fileId, fileVersion, sourceLabel, oneShot, delivery(예정값: attached|inline|metadata_only), sourceTaskId, snapshotId, mode, messageCount, bytes}`. 제외: `at`, `retryOf`, `remoteId`, 실행 결과로 바뀌는 `delivery='failed'`·`error`.
- 단위 테스트: 같은 입력 상태로 `dryRun` 결과와 실제 요청 기록의 위 부분집합이 deep-equal. `bytes`는 첨부 파일 바이트를 제외한 직렬화 크기라 dryRun과 실제가 같아야 한다(임시 원격 ID 길이 차이가 생기면 `files` 배열은 바이트 계산에서 제외 — promptBuilder 이식분 확인 후 필요 시 수정).

### 8.6 참조 메시지 ID 검증 (높음)
- `PUT …/conversation-inputs/{sourceTaskId}`의 `messageIds`(및 `summary.messageIds`): 트랜잭션에서 모두 **원본 스레드 소속·적격(§2.1)·중복 없음** 검증, 하나라도 어긋나면 400 `INVALID_MESSAGE_IDS`. 스냅샷 `seq`는 원본 순서로 서버가 부여(클라이언트 순서 무시).

### 8.7 SSE·오류 경계·phase·이벤트 버퍼 (중간)
- **HTTP 사전 거부(요청 행 없음)**: 404, 409 `TASK_DONE`·`REQUEST_ACTIVE`, 400 입력 검증, 413 `ATTACHMENT_LIMIT`(개수), 멱등 키 누락 400.
- **커밋 후 실패(행 `failed` + SSE `failed`)**: 파일 전달 실패, 요청 크기 한도 초과(`REQUEST_TOO_LARGE` — 기록에 남는 실패, 데모 규칙), 조립 예외, provider 오류, 시간 초과. §1.2 그림의 "413은 행 없이 거부"는 **첨부 개수 한도만** 가리킨다.
- `phase`: `chat_request.phase text`(0003)에 실행기가 갱신(파일 전달 단계 문구, 스트리밍 시작 시 null). `GET /requests/{id}`·`request.updated` 이벤트에 포함.
- `/api/events`: `id`는 서버 프로세스 내 단조 증가 정수(`{bootId}:{seq}`), `Last-Event-ID`가 버퍼 범위 밖이거나 bootId가 다르면 첫 이벤트로 `resync {}`를 보내고 클라이언트는 전체 무효화. 하트비트 15 s, 버퍼 5 분 또는 1000건.

### 8.8 첫 토큰 마감·lease 루프 (중간)
- acquire 직후: `deadline = now + (첨부 있음 ? FILES_FIRST_TOKEN_MS : FIRST_TOKEN_MS)` **하나**. 파일 업로드·처리 대기·provider 호출은 모두 같은 `AbortSignal`과 **남은 시간**을 쓴다(`deliverFiles.processTimeoutMs = min(300 s, 남은 시간)`, 파일 여러 개는 순차이므로 합계가 마감 안에 들어야 함). 첫 토큰 후 `idle` 타이머로 교체.
- lease 갱신 루프는 acquire 직후 시작(10 s마다 `update … set lease_until where id and status in (pending,streaming)`; 0행이면 `abort('lost')`), finalize에서 정지.

### 8.9 보조 호출 (중간)
- AI 제목·요약 초안·(S4) 체크리스트 점검은 `RequestService.runAuxiliary(kind, messages, { timeoutMs: 30 000, signal })`로만 호출 — 요청 기록 없음(D3-2), 스레드 활성 인덱스와 무관, **사용자당 동시 1건**(메모리 세마포어, 초과 시 429), 호출자 취소 가능. AI 제목은 주 요청 finalize 뒤 fire-and-forget이되 같은 세마포어를 쓴다.

### 8.10 pending 행의 NOT NULL 값 (중간·확인 필요)
- acquire 시: `provider = config.llm.mode`, `transport = preset==='openwebui' ? 'openwebui' : 'inline'`, `model = modelResolution(task.modelId › assistant.modelId › 전역 기본)`, `bytes = 0`, `limit_bytes = 현재 한도`, `snapshot = null`. build 후 같은 트랜잭션 없이 `update … where status='pending'`으로 `model·transport·bytes` 확정. 조회 API는 `status='pending' and bytes=0`이면 `bytes: null`로 내보내 "준비 중"으로 표시(임시값이 실제 전송값처럼 보이지 않게).

### 8.11 원격 파일 캐시 (중간)
- `DbLlmPorts.getFiles`가 `file_remote_ref`를 현재 `scope_hash`로 조회해 `FileAsset.remoteIds[scope]`를 채운다(도메인 타입 그대로). `deliverFiles`는 값이 있으면 업로드 대신 처리 상태만 확인, 404·failed면 재업로드 후 `updateFileRemoteIds`로 갱신. 서버·키 변경은 `scope_hash`가 달라져 자연 무효화.

### 8.12 재시도 입력 검증 (누락)
- `excludeFileIds`는 원 사용자 메시지 첨부 ∪ 현재 `task_input`에, `forceInlineFileIds`는 그 중 텍스트 파일에 속해야 한다. 벗어나면 400 `INVALID_RETRY_INPUT`(조용히 무시하지 않음).

### 8.13 참조 대화가 있는 대화의 삭제 정책 (중간) — **사용자 결정 D3-6**
- 현행 S2 `DELETE /api/tasks/{id}`는 하드 삭제(파일 행까지). DDL은 과거 스냅샷이 원본 task를 FK로 보존하므로 한 번이라도 참조된 대화는 삭제가 실패한다.
- (a) **추천**: S3에서 `DELETE /api/tasks`를 **소프트 삭제**(`task.deleted_at` — 0003 추가)로 바꾸고, 목록·후보·검색에서 제외. 참조 기록·스냅샷·요청 기록은 보존(PRD §6 "삭제하지 않음(소프트 삭제)"과 일치). 참조 중(`conversation_input` 현재 선택)이면 여전히 409.
- (b) 현행 하드 삭제 유지 + 과거 스냅샷이 있으면 409 "참조 기록이 있는 대화는 삭제할 수 없습니다"(영구).
- (c) S4로 미룸(S2 규칙 유지, 스냅샷 있으면 409).

### 8.14 정정
- 데모 `chatRunner.test.ts`의 `it`은 11건(+ E5 보호 항목은 별도) — §1.9 표 제목 정정.
- 적격 메시지에 빈 본문 제외 추가(§2.1 정정).

## 9. 결정 요청 (개정 1 합산)

| # | 항목 | 추천 |
|---|---|---|
| D3-1 | `ChatScope.sr` 경로 미리 열기 | 연다 |
| D3-2 | 보조 호출(제목·요약)을 요청 기록에 남길지 | 남기지 않음(§8.9) |
| D3-3 | 스냅샷 파일 전환 임계 | 1 MiB |
| D3-4 | 이벤트 버퍼·하트비트 | 5 분/1000건 · 15 s, `resync` 규칙(§8.7) |
| D3-5 | 완료 대화에서 추정 조회 허용 | 허용 |
| **D3-6** | 대화 삭제 정책(§8.13) | **(a) 소프트 삭제 전환** |
| D3-7 | 멱등 키 헤더 필수(§8.1) | 필수 — 없으면 400 |
