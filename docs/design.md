# MES Assistant Hub — 설계

> **현행 설계는 [conversation-hub.md](conversation-hub.md)** 입니다. 이 문서의 패키지(4장)·어시스턴트 보드(5.3)·패키지 보관함(5.5)은 대화/태그 모델로 대체되었습니다.

> 이 문서는 구현 결과 기준 정리본입니다. 결정 이력과 상세 스펙은 [superpowers/specs](superpowers/specs/2026-09-21-assistant-hub-design.md), 구현 계획은 [superpowers/plans](superpowers/plans/2026-09-21-assistant-hub.md) 참고.

## 1. 컨텍스트

기존 `mes-assistant-platform2`(Vite+React+Dexie 브라우저 전용 데모)는 **워크플로우 템플릿 → 업무 → 단계(Task) → 스레드** 계층이 중심이었다. 새 데모는 **워크플로우 개념을 제거**하고 **어시스턴트(에이전트) 카탈로그**를 중심축으로 재구성한다. 업무는 항상 하나의 어시스턴트에 속하고, 업무 사이의 연결은 **산출물 패키지** 발행/수신으로만 느슨하게 이루어진다. SR 접수 페이지가 추가된다.

목표: 기존과 같은 완성도(스트리밍 채팅, 산출물, 체크리스트, 리포트, 멀티탭 협업, mock/live 전환, 시드 시나리오)를 유지하면서 개념 수를 줄이고, 어시스턴트 카드맵·패키지·SR로 "깔끔한 UI, 직관적 UX"를 보여주는 데모.

### 사용자 결정 사항 (확정)
| 항목 | 결정 |
|---|---|
| 스택 | 기존과 동일: Vite + React 19 + Tailwind v4 + shadcn/ui + Dexie(IndexedDB), 백엔드 없음 |
| 계층 | 업무 1개 = 어시스턴트 1개. 업무 내부에 단계 없음 |
| 연결 | **B. 산출물 패키지** — 업무가 패키지를 발행, 다른 업무가 수신. 링크 아닌 발행/수신 분리 |
| 링크1 | `{OpenWebUI baseUrl}?model={assistantId}` 자동 생성 (assistantId = 사내 AI 모델 ID, 앱 내 채팅에도 사용) |
| 링크2 | 자유 입력 URL (자체 관리 설명 페이지) |
| SR | 접수 도우미와 대화 → 언제든 "접수로 전환" → 대화는 저장되어 재개 가능 → 업무와는 chip/badge로 가볍게 연결(직접 연결 불필요) |

### 가정 → 확정
- 기존 저장소의 `feat/assistant-hub` 브랜치에서 in-place로 전환 (master = 이전 워크플로우 데모).
- 앱 내 채팅은 유지(사내 AI 연결 기능 유지 요구). 링크1은 "OpenWebUI에서 직접 열기" 보조 버튼.
- SR 접수 도우미는 카탈로그의 어시스턴트 중 하나를 `settings.srIntakeAssistantId`로 지정(시드에 "SR 접수 도우미" 포함).

---

## 2. 기존 대비 변경 요약

| 기존 | 새 데모 |
|---|---|
| WorkflowTemplate / StepTemplate / TaskModule 라이브러리 | **삭제**. 대신 `Assistant` 카탈로그 |
| Task(업무) ⊃ StepInstance(단계) | `Task`만 존재, `assistantId` 1개 |
| 단계 간 파일 전달(`deriveInputCandidates`, inputFileIds) | `Package` 발행/수신. 수신 패키지의 파일이 업무 입력 후보 |
| 보드 = 전체 업무 칸반(단계 key 컬럼) | 메인 = 어시스턴트 카드맵. 카드 클릭 → 그 어시스턴트의 업무 칸반(상태 컬럼) |
| 모델 해석: thread > step > task > template > settings | thread > task > assistant > settings |
| 시스템 어시스턴트 도구: create_task/create_template/add_step | create_task / create_assistant / publish_package |
| 리포트: 단계별 병목, 템플릿 통계 | 어시스턴트별 통계(업무 수, 리드타임, 피드백), 패키지 흐름(어시스턴트 A→B 빈도), SR 처리 현황 |
| 없음 | `ServiceRequest` + `/sr` 접수 페이지 |
| 사용자 아바타 이니셜만 | 어시스턴트 이미지 업로드(blob) + 이니셜 폴백 |
| 유지 | 스트리밍 채팅/스레드, 산출물로 저장, 체크리스트, 노트, 파일함(미리보기/드래그업로드), 활동로그, 피드백 별점, 완료 리포트, mock/live + API 프리셋 + 모델 목록, JSON export/import, 시드 리셋, 탭별 사용자 전환 + 타이핑 presence + 스트리밍 잠금, 딥링크 복사 |

---

## 3. 도메인 모델

`src/domain/types.ts` (신규 작성; 기존 파일에서 User/Thread/Message/FileAsset/Note/ActivityLog/Settings 형태 재사용)

```ts
// 사용자 — 기존과 동일
User { id, name, role, initials, color }

// 어시스턴트 카탈로그 (관리페이지 항목 그대로)
AssistantStatus = 'open' | 'working' | 'retired'          // 오픈 / 작업중 / 폐기
Assistant {
  id: string                 // = 사내 AI 모델 ID (예: 'et-urs-assistant'). 링크1의 ?model= 값
  name: string               // AssistantName
  level1: string             // 업무 Lv1 (예: 'ET 개발')
  level2: string             // 업무 Lv2 (예: 'URS 작성')
  summary: string            // 요약
  docUrl?: string            // 링크2 (자체 관리 설명 URL)
  ownerId: string            // 담당자 (User.id)
  status: AssistantStatus
  usageExample: string       // 사용예시 (markdown)
  systemPromptHint?: string  // 앱 내 채팅 시 역할 지침 (기존 AssistantBinding.systemPromptHint)
  imageId?: string           // FileAsset.id (blob). 없으면 이니셜
  color: string              // 이니셜 배경색 (자동 배정)
  checklistTemplate: { id, label, required }[]   // 새 업무 생성 시 복사
  createdBy, createdAt, updatedAt
}
// 링크1은 저장하지 않고 파생: `${settings.llm.baseUrl.replace(/\/api\/?$/, '')}?model=${assistant.id}`
//   → lib/links.ts assistantExternalUrl(settings, assistant)

// 업무 — 어시스턴트 1개에 종속, 단계 없음
TaskStatus = 'todo' | 'in_progress' | 'on_hold' | 'done'   // 칸반 컬럼
Task {
  id, code: 'WK-2026-0001', assistantId, title, summary
  status: TaskStatus, ownerId, assigneeIds[], priority, dueDate?, tags[]
  checklist: ChecklistItem[]          // 기존 ChecklistItem 그대로 (checked/checkedBy/checkedAt)
  inputFileIds[]                      // 채팅 시스템 프롬프트에 주입되는 파일
  outputFileIds[]                     // 산출물 태그된 파일
  activeThreadId?, modelId?           // 업무 단위 모델 오버라이드
  srIds: string[]                     // 연결된 SR (chip). 다대다, 가벼운 태그
  feedback?: { rating, comment, by, at }
  createdAt, createdBy, startedAt?, completedAt?, completedBy?
}

// 산출물 패키지 — 핵심 연결 엔티티
Package {
  id, code: 'PKG-2026-0001'
  fromTaskId, fromAssistantId          // 발행 출처 (비정규화, 보관함 필터용)
  title, summary: string               // 인수인계 메모(markdown). AI 초안 생성 가능
  fileIds: string[]                    // 발행 시점에 고정된 산출물 참조 (파일은 공유, 복사 안 함)
  excerpts: PackageExcerpt[]           // 대화 발췌 (값 복사, 불변)
  suggestedAssistantIds: string[]      // 발행자가 추천하는 다음 어시스턴트 (선택)
  status: 'open' | 'archived'
  publishedBy, publishedAt
}
// 수신 = 별도 junction. 떼기 = 행 삭제, 다시 붙이기 = 행 재생성. 한 패키지를 여러 업무가 수신 가능.
PackageReceipt { id, packageId, taskId, receivedBy, receivedAt }

// 스레드/메시지 — 기존과 동일하되 stepInstanceId → taskId, scope 추가
Thread { id, taskId?, srId?, title, createdAt, createdBy, archived, modelId? }
Message { id, threadId, role, content, authorId?, createdAt, attachmentIds[], status, error?, kind?: 'discussion', requestSnapshot? }

// 파일 — 업무에 종속되지 않음(패키지로 공유되므로 taskId는 '최초 업로드 위치'일 뿐)
FileAsset { id, originTaskId?, originSrId?, name, mime, size, blob, uploadedBy, uploadedAt,
            source: 'upload' | 'assistant' | 'sr', tags[], version, previousId? }   // 같은 이름 재저장 시 버전 체인

Note { id, taskId, authorId, content, createdAt, attachmentIds[] }

// SR
SrStatus = 'draft' | 'submitted' | 'reviewing' | 'in_progress' | 'responded' | 'done' | 'rejected'
ServiceRequest {
  id, code: 'SR-2026-0001', requesterId, title, body: string (markdown)
  status: SrStatus, attachmentIds[], threadId   // 접수 전 대화 스레드 (계속 이어서 대화 가능)
  results: SharedResult[]             // 담당자가 요청자에게 공유한 결과만
  submittedAt?, createdAt, updatedAt
}
// 접수자의 "대화"는 ServiceRequest(status='draft') + Thread 로 표현. 접수 전환 = status→'submitted' + title/body 확정.

ActivityLog { id, taskId?, assistantId?, srId?, packageId?, userId, type, payload, at }
ActivityType: task.created/started/completed/reopened/hold/status_changed, checklist.checked/unchecked,
  file.uploaded/tagged_output/selected_input, note.added, message.sent, thread.created, model.changed,
  feedback.given, package.published/received/detached/archived, assistant.created/updated/status_changed,
  sr.created/submitted/status_changed/linked/unlinked

Settings { id:'app', currentUserId, srIntakeAssistantId?, llm: { mode, baseUrl, apiKey, model } }
```

### Dexie 스키마 (`src/db/schema.ts`)
```ts
this.version(1).stores({
  users: 'id',
  assistants: 'id, status, level1, ownerId',
  tasks: 'id, code, assistantId, status, ownerId, *srIds',
  threads: 'id, taskId, srId',
  messages: 'id, threadId, createdAt',
  files: 'id, originTaskId, originSrId',
  notes: 'id, taskId',
  packages: 'id, code, fromTaskId, fromAssistantId, status',
  packageReceipts: 'id, packageId, taskId, [packageId+taskId]',
  serviceRequests: 'id, code, requesterId, status',
  activity: 'id, taskId, assistantId, srId, packageId, userId, at, type',
  notifications: 'id, userId, read, at',   // v2
  settings: 'id',
})
```

---

## 4. 핵심 아이디어: 산출물 패키지

**원칙**: 업무는 서로를 모른다. 업무는 "패키지를 발행"하거나 "패키지를 수신"할 뿐이다. 파일은 공유 엔티티이며 패키지는 파일 ID의 스냅샷 목록이다.

### 발행 (업무 상세 → "패키지 발행")
1. 다이얼로그: 제목(기본 `${task.title} 산출물`), 포함할 파일(기본: outputFileIds 전체 체크, 다른 파일도 추가 가능), 인수인계 메모(markdown; "AI로 초안 작성" 버튼 → 현재 스레드 요약을 assistant에 요청), 추천 다음 어시스턴트(멀티 선택, 카탈로그에서).
2. 저장 → `Package` 생성, `package.published` 로그, 토스트.
3. **단축 경로**: 다이얼로그 하단 "발행하고 바로 넘기기" → 어시스턴트 하나 선택 → 그 어시스턴트 아래 새 업무 생성(제목 기본 `[받음] ${package.title}`, 담당자 = 어시스턴트 owner) + `PackageReceipt` 자동 생성 + 파일을 새 업무 `inputFileIds`에 세팅 → 새 업무로 이동. 2단계 UX를 한 번에 흡수.

### 수신 (업무 상세 → "패키지 받기")
- 보관함 피커: `status='open'` 패키지 목록, 검색, 필터(출처 어시스턴트 / "이 어시스턴트를 추천한 패키지" 토글 기본 ON). 선택 → `PackageReceipt` 생성 + 패키지 파일을 `inputFileIds`에 추가(중복 제거) + `package.received` 로그.
- 업무 상세 좌측 "받은 패키지" 섹션: 패키지 카드(출처 업무·어시스턴트·메모·파일 n개) + **떼기** 버튼(receipt 삭제, 파일은 inputFileIds에서 제거하되 사용자가 이미 산출물로 태그했으면 유지) + 출처 업무로 이동 링크.
- 새 업무 생성 다이얼로그에도 "패키지 받기" 옵션 (SR과 동일하게 chip으로 표시).

### 프롬프트 주입 (`llm/context.ts` buildTaskSystemPrompt)
```
역할 지침: {assistant.systemPromptHint}
## 어시스턴트: {assistant.name} ({level1} > {level2})  요약
## 업무: {code} {title}  요약 / 체크리스트 요약
## 받은 패키지 (n)   ### {package.title} ← {fromAssistant.name} / 메모 인라인
## 연결된 SR (n)     ### {sr.code} {sr.title} / body 인라인 (≤4,000자)
## 참여자 (≥2명일 때)
## 입력 파일        ### 파일: name + 텍스트 인라인 (≤12,000자) — 기존 로직 그대로
```

### 파생 뷰
- **흐름(체인) 뷰**: 업무 상세 상단에 `발행자 업무 → (패키지) → 이 업무 → (발행한 패키지) → 수신 업무들` 빵부스러기. `PackageReceipt`에서 파생, 저장 없음.
- **패키지 보관함 페이지** `/packages`: 전체 패키지 테이블(코드, 제목, 출처, 파일 수, 수신 업무 수, 상태), 상세 drawer(파일 미리보기/다운로드, 수신 이력, 보관 처리).
- **확장 포인트**: "자주 쓰는 A→B→C를 레시피로 저장"은 이번 범위 밖. 모델상 `Package.suggestedAssistantIds`와 `PackageReceipt` 통계만 있으면 나중에 추가 가능.

---

## 5. 화면 설계

라우트 (`src/app/router.tsx`):
| 경로 | 화면 |
|---|---|
| `/` | 어시스턴트 카드맵 (메인) |
| `/assistants/manage` | 어시스턴트 관리(테이블 + 편집 drawer) |
| `/assistants/:assistantId` | 어시스턴트 보드(업무 칸반/리스트) |
| `/tasks/:taskId` | 업무 상세 |
| `/packages` | 패키지 보관함 |
| `/sr` | SR 접수 (접수자 화면: 대화 + 내 요청 목록) |
| `/sr/manage` | SR 관리(담당자용 목록/상태 변경) — TopBar 사용자 역할과 무관하게 접근 가능(데모) |
| `/reports` | 리포트 |
| `/settings` | 설정 |

### 5.1 메인 카드맵 `/`
- 반응형 n×n 그리드(`grid-cols-2 sm:3 lg:4 xl:5`), 카드 정사각 비율. 카드: 이미지(없으면 이니셜 원형, `assistant.color`) / 이름 / `Lv1 › Lv2` 작은 텍스트 / 요약 1~2줄 / 상태 배지 / 진행중 업무 수 / 담당자 아바타.
- 상단 필터바: 검색(이름/요약/Lv), Lv1 칩 필터, 상태 토글(기본: 폐기 숨김). 정렬: Lv1 > Lv2 > 이름.
- 카드 hover 액션: "새 업무", "OpenWebUI에서 열기"(링크1), "설명"(링크2).
- 클릭 → `/assistants/:id`. 우상단 "관리" 버튼 → `/assistants/manage`.
- 빈 상태: 카드맵 비었을 때 "어시스턴트 등록" CTA.

### 5.2 어시스턴트 관리 `/assistants/manage`
- 테이블 컬럼 = 사용자 명세 순서: 업무Lv1, 업무Lv2, AssistantName, 요약, 링크1(파생·복사·열기), 링크2, 담당자, 상태, 사용예시(툴팁/펼치기). 인라인 상태 변경 셀렉트.
- 행 클릭/신규 → `AssistantEditorSheet`: 이미지 업로드(드래그/파일, 즉시 미리보기, 삭제 시 이니셜 복귀; 정사각 crop 없이 `object-cover`), 필드 전부, `id`(모델 ID)는 서버 모델 목록(`listModels`)에서 선택 또는 직접 입력(생성 후 변경 불가), 링크1 미리보기, systemPromptHint, 체크리스트 템플릿, 사용예시 markdown 편집/미리보기.
- 삭제 대신 상태 `retired`(업무가 있는 어시스턴트는 삭제 불가; 업무 0이면 하드 삭제 허용).

### 5.3 어시스턴트 보드 `/assistants/:assistantId`
- 헤더: 이미지/이니셜, 이름, Lv1›Lv2, 요약, 담당자, 상태, 링크1/링크2 버튼, "사용예시" 펼침, "새 업무" 버튼.
- KPI 4타일: 진행중, 지연, 이번주 완료, 평균 피드백.
- 뷰 토글(zustand persist): **칸반**(컬럼 = `todo / in_progress / on_hold / done`, 카드 드래그로 상태 변경 — dnd-kit 재사용) / **리스트**(테이블: 코드, 제목, 담당, 우선순위, 기한, 체크리스트 진행, 받은 패키지·SR chip, 갱신일).
- 필터: 검색, 담당자, 우선순위, "완료 숨김".
- 업무 카드: 코드·제목·우선순위 색띠·기한(지연 빨강)·담당 아바타·체크리스트 진행바·chip(`📦 n`, `SR n`).

### 5.4 업무 상세 `/tasks/:taskId`
기존 `StepPanel` 3컬럼 레이아웃을 업무 단위로 축소.
- 헤더: 어시스턴트 배지(클릭 시 보드로) · 코드 · 제목(인라인 편집) · 상태 셀렉트 · 우선순위 · 기한 · 담당 · **SR chip 영역**(chip 클릭 → SR 상세 popover, `x`로 떼기, `+ SR 연결` → 피커) · 딥링크 복사 · "업무 완료"(완료 리포트 다이얼로그) · 더보기(보류/재개, 삭제).
- 흐름 빵부스러기(4장 파생 뷰).
- 좌측: 받은 패키지 섹션(카드+떼기) / 입력 파일 피커(후보 = 받은 패키지 파일 + 업무 업로드 파일; 체크 = inputFileIds) / 체크리스트.
- 중앙: `ChatView`(스레드 탭, 참여자, 타이핑, 스트리밍 잠금, 제안 칩 = assistant.usageExample에서 추출 또는 기본 3개) + `ModelPicker`(scope: thread/task; 해석 체인 표시) + 메시지 "산출물로 저장".
- 우측 탭: 파일 / 노트 / 히스토리.
- 하단 고정 액션바: **패키지 발행** · 패키지 받기 · OpenWebUI에서 열기.
- 완료 다이얼로그: 필수 체크리스트 누락 경고(비차단, `missingRequired` 기록), 산출물 일괄 태그, 피드백 별점+코멘트, 완료 리포트 markdown 생성·다운로드·파일함 저장(기존 `taskReport.ts` 축소).

### 5.5 패키지 보관함 `/packages` — 4장 참조.

### 5.6 SR 접수 `/sr` (접수자 화면)
- 좌측 "내 요청" 목록(현재 탭 사용자 기준 `requesterId`): 초안(대화 중)/접수됨/검토중/진행중/완료/반려 배지, 클릭 시 우측에 로드. "새 대화" 버튼.
- 우측: 접수 도우미 채팅(`ChatView` 재사용, thread.srId). 첨부 가능. 시스템 프롬프트 = 접수 도우미 assistant hint + "요청 내용을 구조화(제목/배경/원하는 결과/기한)하도록 유도".
- 언제든 상단 **"접수로 전환"** → 다이얼로그: 제목·본문 초안을 대화에서 AI가 생성(mock에서는 마지막 user 메시지 기반 규칙 생성) → 편집 → 제출 → `status='submitted'`, 코드 부여. 이후에도 같은 스레드에서 대화 계속 가능(추가 문의), 접수 내용 수정은 `reviewing` 전까지만.
- 대화 중 이탈해도 `draft` SR + Thread가 IndexedDB에 남아 목록에서 재개.
- 접수자 SR 상세: 상태 타임라인(activity 기반), 연결된 업무 코드 배지(읽기 전용, 담당자가 chip으로 붙였을 때만 표시).

### 5.7 SR 관리 `/sr/manage` (담당자)
- 테이블: 코드, 제목, 접수자, 상태(셀렉트로 변경), 접수일, 연결 업무 수. 행 클릭 → drawer: 본문, 첨부, 대화 읽기, "업무에 연결"(업무 피커 → `task.srIds` 추가), "이 SR로 새 업무 만들기"(어시스턴트 선택 → 업무 생성 + chip + SR 첨부를 업무 inputFileIds에 추가).

### 5.8 리포트 `/reports`
기존 `reporting.ts` 구조 유지, 축 변경: 기간 7/30/90일, 담당자 필터. KPI(완료 수, 평균 리드타임, 재오픈, 체크리스트 이행률, SR 평균 접수→완료). 차트: 완료 추이 / 어시스턴트별 평균 리드타임(병목 강조) / 사용자별 활동 / **패키지 흐름**(from 어시스턴트 → 수신 어시스턴트 상위 N 표) / SR 상태 분포. 비효율 신호: 재오픈, 필수 체크 누락 완료, 장기 업무 ≥10일, 방치 ≥5일, 받았지만 미사용 패키지(받았는데 inputFileIds에 없음). 피드백 다이제스트 어시스턴트별.

### 5.9 설정 `/settings`
기존 그대로 + `srIntakeAssistantId` 셀렉트. 링크1 base 미리보기.

### 5.10 시스템 어시스턴트 drawer
기존 구조 유지, 도구 교체: `create_task(assistantId, title, summary, priority)`, `create_assistant(...)`, `publish_package(taskId, title, summary, fileIds)`, `link_sr(taskId, srId)`. Mock 파서 규칙 갱신.

### 공통 UI/UX 원칙
- 상단 TopBar: 페이지 제목, 사용자 전환, LLM 모드 pill, 시스템 어시스턴트 버튼. 사이드바 5항목: 홈(카드맵), 패키지, SR, 리포트, 설정.
- 색: 어시스턴트 `color`가 카드·배지·칸반 카드 좌측띠에 일관 사용. 상태 배지 컬러 고정(open=초록, working=파랑, retired=회색 / todo=회색, in_progress=파랑, on_hold=주황, done=초록).
- 모든 목록 빈 상태 일러스트+CTA, 모든 파괴 액션 confirm(Dialog, `window.confirm` 금지), 토스트로 결과.
- 키보드: 채팅 Enter 전송·Shift+Enter 줄바꿈, 노트 Ctrl+Enter.

---

## 6. AI 연결

- `src/llm/*` 기존 파일 **그대로 복사**: `provider.ts`, `openaiProvider.ts`, `sse.ts`, `useModelList.ts`, `index.ts`. `mockProvider.ts`는 시나리오 키를 StepKey → assistantId 기반으로 변경(`mockScenarios.ts`: assistant별 턴 스크립트 + SR 접수 도우미 스크립트).
- `context.ts`: `buildTaskSystemPrompt(assistant, task, packages, srs, inputFiles, participants)` / `buildSrSystemPrompt(intakeAssistant, sr, files)`. `toChatMessages` 그대로.
- 모델 해석 `domain/modelResolution.ts`: `thread.modelId > task.modelId > assistant.id > settings.llm.model`. 어시스턴트 자체가 모델 ID이므로 사실상 항상 해석됨; 서버 모델 목록에 없으면 ModelPicker 경고(기존).
- 링크1: `lib/links.ts` — `baseUrl`에서 `/api` 접미사 제거 후 `?model=`. 설정에 "OpenWebUI 웹 URL" 별도 필드는 두지 않고 파생(가정; 필요 시 `settings.llm.webUrl` 추가 한 줄).
- 파일 인라인 제한, CORS/키 보관 한계는 기존 design.md와 동일하게 문서화.

## 7. 실시간/멀티유저
기존 메커니즘 그대로: `useLiveQuery` 크로스탭 동기화, 250ms 스트리밍 flush, `tabUser.ts` 탭별 사용자, `presence.ts` BroadcastChannel 타이핑, 스트리밍 잠금. SR 페이지에서 접수자 탭과 담당자 탭을 나란히 열어 데모.

## 8. 프로젝트 구조 & 재사용 매핑

```
mes-assistant-hub/
  src/app/        router, AppShell, TopBar, hooks, uiStore, tabUser, presence   ← 복사 후 nav만 수정
  src/domain/     types, transitions(task status), packages.ts(입력 후보 파생), modelResolution, reporting, taskReport, links
  src/db/         schema, exportImport(테이블명 갱신), repositories/{assistants,tasks,packages,sr,chat,files,notes,settings,activity}, seed/*
  src/llm/        복사 + context/mock 수정
  src/features/   home(카드맵), assistants(manage, board), task, chat, packages, sr, reports, settings, system-assistant
  src/components/ Markdown, StatusBadges(재정의), UserAvatar, AssistantAvatar(신규: 이미지/이니셜), ui/*
  src/lib/        ids, dates, labels, blob, utils, links
  docs/design.md  이 설계서 정리본
```

| 기존 파일 | 처리 |
|---|---|
| `llm/provider.ts, openaiProvider.ts, sse.ts, useModelList.ts, index.ts` | 그대로 |
| `features/chat/*` (useChat, ChatView, MessageBubble, Composer, ModelPicker, SaveAsOutputDialog) | step→task 치환, SR 스레드 지원(`taskId` 없을 때 SR 프롬프트) |
| `features/task/{ChecklistPanel,NotesPanel,ActivityPanel,FilesPanel,FileList,FilePreviewDialog,InputFilePicker,TaskCompleteDialog}` | step 제거하고 task 단위로 |
| `features/settings/SettingsPage`, `db/exportImport`, `app/*`, `components/ui/*`, `lib/*` | 거의 그대로 |
| `features/reports/*`, `domain/reporting.ts` | 축(assistant/package/SR)으로 재작성, charts 재사용 |
| `features/dashboard/*`, `features/templates/*`, `features/modules/*`, `domain/fileHandoff.ts`, `db/repositories/{templates,modules}` , `WorkflowStepper`, `InsertStepDialog`, `ComposeWorkflowDialog`, `CompleteStepDialog` | **삭제** (칸반 카드/컬럼 컴포넌트는 board로 이식) |
| 미사용 자산(`hero.png`, `icons.svg`, `next-themes`, 미사용 ui) | 가져오지 않음 |

## 9. 시드 시나리오 (`db/seed/*`)
- 사용자 5명(기존).
- 어시스턴트 10개: ET 개발(URS 작성, FDS 작성, 코드 리뷰, 테스트 시나리오, 배포 체크), 장비 마스터(변경 검토), 품질(일탈 보고서 초안), 공통(회의록 정리 — `working`, 레거시 SQL 변환 — `retired`), **SR 접수 도우미**. 이미지 없음(이니셜) 2~3개는 시드 SVG blob 이미지.
- 업무 ~14개, 상태 분산. 패키지 4개: URS→FDS 수신 완료, FDS→코드리뷰 수신 후 **떼어낸** 이력 1건, 발행만 되고 미수신 1건, 추천 어시스턴트 2개 지정 1건.
- SR 6개: draft 1(대화 중), submitted 2, in_progress 2(업무 chip 연결), done 1.
- 활동 로그는 기존 `SeedBuilder` 패턴으로 시간축 생성(리포트 수치가 채워지도록).
- 데모 스토리: 카드맵 → URS 어시스턴트 보드 → 업무 채팅 → 산출물 저장 → 패키지 발행+바로 넘기기 → FDS 업무에서 받은 파일이 프롬프트에 주입됨 확인 → 떼기/다시 받기 → SR 탭(다른 사용자)에서 대화→접수 → 담당자가 업무에 chip 연결 → 리포트.

## 10. 확장 포인트 (범위 밖, 모델에 자리만 둠)
- 체인 레시피(A→B→C 저장/일괄 생성): `PackageReceipt` 통계 + `suggestedAssistantIds`로 시작 가능.
- 백엔드 도입 시: repositories 인터페이스 그대로 두고 Dexie → REST 교체, 스트리밍은 서버 프록시.
- OpenWebUI Files API로 파일 인라인 대체.
- SR ↔ 업무 상태 자동 동기화(현재는 수동 chip).

