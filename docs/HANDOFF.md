# HANDOFF — MES Agent Hub

다른 세션(사람 또는 AI)이 이어서 작업할 수 있도록 컨셉·현재 상태·결정 사항·남은 일·주의점을 한곳에 정리한다.
기준 시점: 2026-09-23, `master` = `feat/platform-scope` 머지 직후.
추가(2026-09-26): 형제 저장소(Codex)와의 비교·융합 설계와 진행 방식 판단은 [fusion-design.md](fusion-design.md). 이 저장소는 **데모로 마무리**하고 실제 구현은 별도 저장소에서 한다(D16). 추천안 2-b(짧은 UX 검증 스프린트)를 `feat/ux-sprint`에서 반영해 master에 병합·push했다(D17, 2026-09-26) — 결과 [evaluation/context-flow.md](evaluation/context-flow.md). 2026-09-27: 정책 확정(D18)·스택(D20)·인증(D21) 결정, 데모 동결 태그 `demo-final`. **새 저장소 착수 자료: [next-project/README.md](next-project/README.md)** (PRD·아키텍처·OpenAPI, 데이터 계약·DDL).

---

## 1. 한 줄 요약

사내 AI 에이전트(OpenWebUI assistant)를 **카드로 골라 대화**하고, 대화끼리 **태그로 느슨하게 연결**해 **파일을 주고받는 플랫폼**의 프론트 전용 데모.
각 에이전트의 워크플로우는 assistant 안에 있고, 이 플랫폼은 **대화창 + 파일 주고받기 + 진행 기록**만 깔아 준다.

## 2. 컨셉 (반드시 지킬 원칙)

| 원칙 | 의미 | 코드 위치 |
|---|---|---|
| **플랫폼 ≠ 워크플로우** | 질문 흐름·작성 절차·역할 프롬프트는 각 assistant(OpenWebUI) 안에서 구현된다. 플랫폼은 흐름을 지시하지 않는다. system 메시지는 "플랫폼 컨텍스트"(대화·태그·연결 SR·고른 입력)만 | `src/llm/context.ts` (`PLATFORM_CONTEXT_NOTE`) |
| **대화 1개 = 업무 1개** | `Task` 엔티티가 곧 대화. 스레드 1개 고정 | `src/domain/types.ts` `Task.threadId` |
| **지연 생성** | 카드 클릭은 초안(`/new/:id`)만 연다. 첫 전송/첨부 때 대화 생성 → 빈 업무 없음 | `features/conversation/DraftConversationPage.tsx` |
| **태그로 느슨한 결합** | SR 코드(`SR-YYYY-NNNN`) + 자유 키워드. 붙였다 떼도 됨 | `src/domain/tags.ts` |
| **발견과 사용의 분리** | 같은 태그를 **직접** 공유하는 대화의 파일·**대화 자체**가 후보로 "보임"(간접 확산 없음). **사람이 ☑참고/★주 입력으로 고른 것만** AI로 감. 파일은 버전, 대화는 선택 시점 스냅샷에 고정 — 자동 교체 없음, 태그 해제해도 선택 유지 | `sharedPool()`, `Task.inputs`, `conversationInputs` |
| **보낸 것 = 본 것** | 입력창 위 트레이와 실제 전송이 같은 조립 함수를 쓴다. 자동 절단·자동 요약 없음 — 요청 크기 한도를 넘으면 전송을 막는다. 답변마다 사용한 자료·전달 방식을 기록 | `llm/promptBuilder.ts`, `domain/requestBudget.ts` |
| **요청은 실행기가 소유** | 대화당 진행 중 요청 1건(트랜잭션), 생존 신호·끊긴 응답 정리, 화면을 옮겨도 계속, 실패 시 재시도(사용자 메시지 재사용) | `app/chatRunner.ts` |
| **OpenWebUI는 API + 링크만** | 채팅·모델 목록·파일 업로드는 API 호출. 화면 연동은 "OpenWebUI에서 열기" 링크(해당 assistant 대화창)뿐. 플랫폼 대화 기록은 OpenWebUI 채팅 목록에 남지 않는다 | `src/llm/openaiProvider.ts`, `openwebuiFiles.ts`, `lib/links.ts` |
| **체크리스트는 강제 아님** | 에이전트별 기본값 → 새 대화에 복사. "AI 달성도 점검"으로 m/n 참고 점수, 원하면 "판단대로 체크" | `domain/checklistReview.ts`, `features/task/ChecklistReviewCard.tsx` |
| **공개 저장소** | GitHub 저장소가 PUBLIC. 참고 이미지·사내 주소·이미지에서 옮긴 문구는 절대 커밋 금지 | 7장 참고 |

## 3. 기술 스택 · 실행

- Vite 8 · React 19 · TypeScript 6 · Tailwind v4 · shadcn/ui · react-router 8 · Dexie 4(IndexedDB, `useLiveQuery`) · zustand · dnd-kit · recharts
- 테스트: `npm test`(vitest + fake-indexeddb, 27개 파일 · 160개) · `npm run test:e2e`(Playwright + 설치된 Edge, 15개, 가짜 OpenWebUI — 결과물은 `%TEMP%/mes-hub-e2e`) · `npm run typecheck` · 린트 `npx oxlint` (shadcn 기본 경고는 기존 상태)
- 실행: `npm install` → `npm run dev` (http://localhost:5174) · 빌드 `npm run build`
- 백엔드 없음. 데이터는 브라우저 IndexedDB(`mes-assistant-hub`), 첫 실행 시 시드 자동 주입. 설정에서 JSON 내보내기/가져오기, 시드로 초기화
- LLM: 설정에서 Mock(대역 응답) / Live(OpenAI 호환 `{baseUrl}/chat/completions` SSE)

## 4. 구조 (시스템 분석)

```
src/
  domain/        순수 로직 (테스트 대상): types, tags(sharedPool·정규화), kanban(필터·URL), checklistReview,
                 titles(제목 규칙), modelResolution, reporting, taskReport, transitions, srDraft
  app/           chatRunner(요청 실행기: 활성 1건·생존 신호·시간 제한·재시도·중지) …
  db/            schema.ts(Dexie v1→v4), migrations/v3.ts(구 패키지 모델 변환), exportImport.ts(백업 v3, 비밀값 제외, v1·v2 가져오기)
    repositories/  tasks(대화·태그·입력·체크·달성도) · conversationInputs(참조 대화·스냅샷) · sr · files(버전 체인) · assistants(순서) · chat(메시지 순서·활성 응답 확인) · activity · notifications · settings
    seed/        users · assistants(12개 카탈로그, 기본 체크리스트) · data(대화 11 · SR 6) · builder
  llm/           provider 인터페이스, openaiProvider(SSE, files 파라미터), mockProvider/mockScenarios(대역),
                 context(플랫폼 컨텍스트 프롬프트·참조 대화 절), promptBuilder(요청 조립·전달 방식 기록·크기, dryRun=트레이),
                 openwebuiFiles(업로드·처리 상태 확인·버전 이름), conversationSummary(요청 시 요약), title(AI 제목), checklistReview(달성도)
  features/
    home/        HomePage(카드|칸반 토글), AssistantCard, SortableAssistantGrid(SO 편집 모드), ConversationKanban, ConversationCard
    conversation/ DraftConversationPage (/new/:assistantId)
    task/        TaskPage(/c/:taskId), TaskHeader(태그·연결된 대화), TaskBody, MaterialsPanel(자료함·입력 선택·같은 태그 대화), ConversationInputs, ConversationPickerDialog(전체·메시지·요약), ChecklistPanel(+ReviewCard), Notes, Activity, CompleteDialog
    chat/        useChat(실행기 래퍼), ChatView, ContextTray(이번 요청에 사용·크기), Composer(첨부 고정 전환), MessageBubble(사용한 자료·복구), RequestInfoDialog(전송 기록), ModelPicker, SaveAsOutputDialog
    sr/          SrIntakePage(/sr), SrManagePage(/sr/manage), SrDetailSheet(진행 현황·연결 업무 시작), SrConvertDialog(AI 제목), SrTitleEditor
    assistants/  ManagePage(/assistants/manage), AssistantTable(모델 ID 인라인), AssistantEditorSheet(전 항목·체크리스트)
    reports/ settings/ system-assistant/
  components/    TagChip, TagInput(자동완성), StatusBadges, AssistantAvatar …
```

### 데이터 흐름 (대화 전송)
1. `ChatView` → `useChat.send`: 첨부는 기본으로 대화 입력(☑)에 고정(칩에서 "이번 메시지만" 가능) → `chatRunner.startChat`
2. 한 트랜잭션에서 완료 여부·진행 중 응답 확인 → 사용자 메시지 + 답변 자리표시(`heartbeatAt`) 생성. 두 번째 요청은 `ActiveRequestError`로 거부(입력 보존)
3. `buildChatRequest`: 최신 `task` 재조회 → 입력 파일(주 입력 → 참고 → 이번 메시지) + 참조 대화 스냅샷 + 태그의 SR → 입력별 전달 방식(attached/inline/metadata_only/failed)·크기 기록
4. Live + OpenWebUI면 버전 이름으로 업로드 → 처리 완료 확인 → `files`로 첨부. **실패가 하나라도 있으면 모델을 호출하지 않고** 답변 자리에 재시도·빼고 다시·텍스트로 보내기
5. 요청 크기 한도 확인 → provider.stream(첫 토큰 60초/파일 360초, 토큰 사이 60초) → 250ms마다 DB 반영(이미 다른 곳에서 끝난 답변은 덮어쓰지 않음)
6. 답변에 `requestInfo`(사용한 자료)·`requestSnapshot`(원본 JSON) 저장. 첫 답변 뒤 기본 제목이면 AI 제목(수동 제목 보호)
7. 앱 시작·30초마다·화면 복귀 시 생존 신호가 끊긴(120초) 자리표시를 오류로 정리 (자동 재전송 없음)

### 모델 결정
이 대화 지정 › 에이전트 매핑(`Assistant.modelId`) › 설정의 공통 기본 모델. 링크에서 모델을 추정하지 않음. 링크1은 저장값 우선, 없으면 `{OpenWebUI}/?model={모델 ID}`

### 라우트
`/`(카드|`?view=kanban`) · `/new/:assistantId` · `/c/:taskId`(`/tasks/:id` 리다이렉트) · `/assistants/manage` · `/sr` · `/sr/manage` · `/reports` · `/settings`

## 5. 결정 사항 로그

| # | 결정 | 근거/출처 |
|---|---|---|
| D1 | 패키지(발행/받기/발췌) 제거 → 태그로 일원화 | 사용자 선택 |
| D2 | 대화 1개 = 스레드 1개 | 사용자 선택 |
| D3 | 칸반 열 = 에이전트(카드와 같은 공통 순서), 단계는 Lv1/Lv2 다중 필터 | 사용자 피드백 + Codex 안 일반화 |
| D4 | 순서는 공통 설정, System Owner가 편집 모드에서 변경(저장/취소, 필터 중 차단) | 사용자·Codex |
| D5 | SR 태그만 저채도 결정색, 일반 태그는 중립색. SR 태그 개수 제한 없음 | 사용자 |
| D6 | 공유 자료함은 직접 태그 공유만, 사람이 고른 입력만 AI 전달, 새 버전 자동 교체 없음 | Codex 안 채택 |
| D7 | 접수 에이전트 = URS 분석 도우미(가상 카탈로그 기준), 명시적 "접수로 전환", AI 제목 별도 요청, 수동 제목 보호 | Codex 안 채택 |
| D8 | 모델 ID는 기본 비움(공통 기본 모델), 관리 페이지에서 매핑 | 사용자 |
| D9 | 워크플로우는 assistant 쪽 — 역할 지침 주입 제거, Mock 흐름은 대역으로 명시 | 사용자 (2026-09-23) |
| D10 | 입력 파일은 OpenWebUI Files API로 첨부(프리셋 기본), 실패분만 인라인 | 사용자 승인 |
| D11 | 체크리스트: 기본값 + 관리 페이지에서 수정, 강제 없음, AI 달성도 m/n 버튼 | 사용자 |
| D12 | OpenWebUI와 UI 연동 없음, API 호출 + 대화창 링크만 | 사용자 |
| D13 | 시드는 가상 카탈로그. 사내 주소·이미지 문구 제거, 공개 저장소 이력은 커밋 1개로 초기화 | 사용자 (노출 금지) |
| D14 | System Owner는 여러 명: 박비오·김해윤·김남우·이희준·노기현 (실명 사용은 사용자가 공개 노출을 인지하고 요청) | 사용자 |
| D15 | 대화 간 컨텍스트: **같은 태그를 직접 공유하는 대화를 파일처럼 통째로 선택**하고 필요하면 메시지 선택·요약으로 세부 조절. 기본은 전체 원문. 단계·순서를 참조 조건으로 쓰지 않음(순서 기반 인계·"인계 메모"·"다음 단계로 넘기기" 없음). 자동 절단·자동 요약·재귀 수집 금지 | 사용자 (2026-09-26, Codex 논의에서 확정) |
| D16 | 이 저장소는 데모로 마무리하고 실제 구현은 별도 저장소에서 진행 | 사용자 (2026-09-26) |
| D17 | 진행 방식 2-b(새 저장소로 넘어갈 UX만 데모에서 검증) 채택. [fusion-design.md](fusion-design.md) §6의 추천 정책을 기본값으로 적용 — 현업 시험 후 확정. **D10 변경**: 파일 전달 실패 시 자동 인라인 대신 요청 중단 + 항목별 선택 | 사용자 "추천대로 진행" (2026-09-26) |
| D18 | 미확정 정책 12개를 추천값대로 확정 (현업 시험은 이전 버전 시험으로 대신) | 사용자 (2026-09-27) |
| D19 | 에이전트 관리(추가·수정·삭제·순서)와 전역 설정은 System Owner만 — 새 저장소에서 서버 강제 (데모는 인증이 없어 그대로) | 사용자 (2026-09-27) |
| D20 | 새 저장소 스택: TypeScript 풀스택(React + NestJS + PostgreSQL + Drizzle) — 데모 소스 재사용 우선, Spring 초안 철회 | 사용자 요청 기준으로 결정 (2026-09-27) |
| D21 | 인증: 사내 SSO(OIDC/SAML 표준)의 수신 측만 구현, 역할은 앱이 관리, 개발은 Keycloak 대역 | 사용자 (2026-09-27) |

## 6. 진행 현황

### 완료
- 도메인/스키마 v3 전환, 구 데이터·구 백업 자동 변환 (테스트: `db/migrations/v3.test.ts`, `exportImport.test.ts`)
- 홈 토글, 카드 → 초안 대화(지연 생성), SO 편집 모드(드래그·저장), 전체 대화 칸반(필터 URL 동기화)
- 대화 화면: 태그 입력·자동완성, 연결된 대화, 자료 패널(AI 입력·공유 자료함·SR 첨부·이 대화 파일, 버전 비교체), AI 제목
- SR: 접수 → AI 제목 → 관리 → 연결 업무 시작(이어가기/새 대화) → 진행 현황 · 결과 공유
- 관리 페이지: 전 항목 편집(이미지·모델 ID·링크1/2·입출력 안내·체크리스트 순서/기본값), 모델 ID 인라인, 삭제 보호
- 플랫폼 범위 정리(D9–D12), OpenWebUI Files API 전달, AI 달성도
- 리포트: 자료 흐름·태그별 대화·비효율 신호(이전 버전 입력 등)
- 검증(2026-09-23 기록): 단위 110개, 브라우저 스크립트로 주요 흐름·전 라우트 1280/375px 오류 0, 가짜 OpenWebUI 서버로 Live 경로 확인
- **2-b UX 검증 스프린트(2026-09-26, `feat/ux-sprint`)**: 기준선 E1 8개 중 1개 통과 → 결함 수정 후 8개 통과. 같은 태그 대화를 입력으로 선택(전체·메시지·요약, 스냅샷 고정·갱신 안내), 트레이·사용한 자료·전송 기록 뷰어, 자동 절단 제거 + 요청 크기 한도, OpenWebUI 처리 확인·실패 시 중단·복구, 요청 실행기(활성 1건·생존 신호·재시도), 백업에서 비밀값 제외. 단위 160개 · E2E 15개 통과, 1280/375px 전 라우트 넘침·콘솔 오류 0 → [evaluation/context-flow.md](evaluation/context-flow.md)
- 새 저장소용 데이터 계약·DDL 초안·API 대응표 → [architecture/data-contract.md](architecture/data-contract.md)

### 남은 일 / 미결정
| 우선 | 항목 | 메모 |
|---|---|---|
| 완료(결정) | 관리 페이지 수정 권한 → **System Owner만**(D19). SO 지정 UI는 새 저장소 관리 화면에서 SO가 지정 | 데모는 인증이 없어 적용하지 않음 |

| **다음** | **새 저장소 착수** — 현업 시험 생략·정책 확정(D18)·데모 동결(`demo-final`) 완료 | [next-project/README.md](next-project/README.md). 첫 스프린트에서 실제 OpenWebUI 확인 |
| 높음 | **실제 사내 OpenWebUI 연동 확인** — CORS 허용 필요, Files API 응답 형식·`files` 파라미터 동작, 모델 ID 매핑 | 가짜 서버로만 검증됨 |
| 높음 | 인증 없음 — 사용자 전환은 시연용(누구나 SO 가능). 운영 시 사내 SSO 연동 필요 | |
| 중간 | assistant가 **생성한 파일**을 플랫폼 산출물로 받는 경로 — 현재는 답변 텍스트를 "산출물로 저장"만 | OpenWebUI 응답의 파일 참조 처리 |
| 중간 | 브라우저 저장 한계(용량·공유), 크로스 PC 실시간 없음 → 백엔드 필요 | |
| 낮음 | 번들 크기(주 JS 1,183 KB / gzip 364 KB, 2026-09-26 측정) 청크 분할, 모바일 칸반 세로 스크롤 UX | |
| 낮음 | 시각 다듬기 보류분: Pretendard 폰트, 다크 모드, 10px 이하 글자, 칸반 열 개별 접기 | 새 저장소로 이월 가능 |
| 낮음 | 업무 코드(WK/SR)를 클라이언트가 최대값+1로 발급 — 동시 생성 시 중복 가능 | 데모 한계. 새 저장소는 DB 시퀀스·고유 제약 |

## 7. 주의사항 (함정)

- **공개 저장소 규칙**: 참고 이미지(에이전트 목록·워크플로우 다이어그램·과제 계획서 등), 사내 AI 포털 주소, 양식 번호, 이미지에서 옮긴 문구는 커밋 금지. 커밋 전 `git grep`으로 확인. 루트의 `*.png/*.jpg`는 `.gitignore`로 막아 둠
- 로컬에만 있는 `backup/before-history-reset` 브랜치에는 초기화 전(민감) 이력이 있다. **절대 push 금지**
- Windows 환경: 일부 파일이 CRLF. 스크립트로 치환할 때 줄바꿈을 정규화할 것. 화면 점검 스크립트의 스크린샷은 저장소 밖(스크래치 폴더)에 저장
- `useLiveQuery`는 마운트 직후 `undefined` — 기본값을 여기에 의존하면 안 됨(관리 시트의 담당자 버그가 이 원인이었음)
- 초안 → 대화 전환 시 첫 메시지는 history state로 넘기고 `TaskPage`가 전송 후 로컬 상태까지 비움(리마운트 중복 전송 방지)
- 예전 브라우저 데이터는 이전 시드를 그대로 가짐 → 설정 → "시드 데이터로 초기화"
- **요청은 `app/chatRunner.ts`만 보낸다.** 화면에서 provider를 직접 부르지 말 것(활성 1건·기록·복구가 깨진다). 보조 요청(제목·달성도·요약)만 예외
- 메시지 시각은 `nextMessageTime`으로 스레드 안에서 증가하게 만든다(같은 밀리초 정렬 문제). 메시지를 직접 `add`하지 말 것
- 참조 대화 스냅샷은 메시지 **ID만** 가진다 — 완료된 메시지를 수정하는 기능을 만들면 이 전제가 깨진다
- 트레이 추정은 `buildChatRequest({ dryRun: true })` — 실제 전송과 같은 함수여야 "본 것 = 보낸 것"이 유지된다
- E2E(`npm run test:e2e`)는 5174 포트 개발 서버를 재사용한다. 스크린샷·trace는 저장소 밖(`%TEMP%/mes-hub-e2e`)
- PowerShell에서 `R`은 `Invoke-History` 별칭 — 치환 스크립트에 `R`이라는 함수 이름을 쓰지 말 것

## 8. 다음 세션 시작 체크리스트

1. `git pull` → `npm install` → `npm run typecheck` · `npm test` · `npm run test:e2e` 녹색 확인
2. 이 문서 5·6장(결정/미결정) 확인 후 사용자에게 미결정 항목부터 확인
3. 기능 작업은 `feat/*` 브랜치 → 커밋 전 민감 문자열 검사 → master 머지·push
4. 문서: 사용자용 [README](../README.md), 설계 [conversation-hub.md](conversation-hub.md), 융합 설계 [fusion-design.md](fusion-design.md), 실제 환경 검증 절차 [evaluation/real-env-verification.md](evaluation/real-env-verification.md). 이 문서는 상태 변경 시 함께 갱신
