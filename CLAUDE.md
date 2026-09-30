# MultiAgent Orchestration — Operating Rules

## Architecture

```
Orchestrator (Claude Code session, internal reasoning)
└── Worker Pool (모두 외부 호출 — 승인 필요)
    ├── claude-main    [strategist] 기획 · 설계 · 아키텍처 · 전략 · 디자인 방향 · 문체 글쓰기 · 디버깅 원인 분석
    ├── codex-main     [engineer·computer-use] 대규모 구현 · 코드 분석 · 테스트 · diff · 로컬 검증 · 브라우저 자동화 · 이미지 생성
    ├── codex-critic   [reviewer] 산출물 리뷰·비평 (Codex의 주된 역할)
    └── gemini         [multimodal] 멀티모달 · 긴 문서 · 제3자 시각의 검토
```

능력 슬롯 → 워커 배정의 정본은 `_shared/capability-profile.md`(가변층 — 신모델 출시 시 프로필만 갱신).

**중요**: Orchestrator의 내부 추론은 worker가 아님. claude-main worker 호출은 별도 모델 호출이므로 승인·쿼터 대상.

## 운영 원칙 (Operating Principles)

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

**층별 적용**: 위 4원칙 풀버전은 Orchestrator(이 세션) 전용이다. 워커층 규약의 유일 정본은 `_templates/worker-brief.md`의 "Worker 행동 규약" 고정 블록 — ②단순함·③외과수술식은 그대로, ①은 번역형(워커는 one-shot/headless라 사용자 질문 채널 없음 → 가정을 명시하고 불확실·불일치를 result.md Issues/Caveats에 표면화), ④ loop은 Orchestrator만(Verification Checklist 루프와 결합). 워커 brief나 agent 정의에 "사용자에게 질문" 지시를 넣지 말 것. agent 정의에 규약 중복 금지.

> 출처: [multica-ai/andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills) (MIT) — adapted. 상세는 `NOTICE` 참조.

## Task Lifecycle

1. `tasks/<task-name>/task.md` 작성 (status: pending) — **형식은 `_templates/task.md` 그대로**(`## 메타` yaml 펜스 + `## Goal`, frontmatter `---` 금지 — mat 모니터가 이 형식을 파싱). 단, 새 폴더가 기존 작업의 후속·핸드오프·하위 단계면 생성 전 `_shared/orchestrator-rules.md` §3 "새 작업 폴더 생성 게이트"를 먼저 적용
2. `_shared/routing.md` 참조 → 최소 worker set 결정
3. **target_repo 확인** (외부 산출물 작업인 경우):
   - codex-main이 planned_workers에 포함되거나 코드·문서·이미지를 만드는 작업이면 사용자에게 `target_repo` 경로를 묻는다
   - 사용자가 "없음"이라고 답하거나 분석·리뷰·요약·기획만 하는 작업이면 묻지 않고 `tasks/<task>/artifacts/`에 diff·patch로 산출
   - 사용자가 자연어 요청에 이미 경로를 포함했으면 다시 묻지 않음
4. 모든 worker(claude-main 포함) 사용 시 `task.md`의 `workers_approved`에 명시적 기록 필요
5. 각 worker의 brief를 **정확히 `tasks/<task>/workers/<role>/brief.md`** 에 작성 (≤ 1200자 한글 / 240단어 영문). 워커별 폴더로 분리할 것 — `<role>_brief.md`처럼 납작하게 만들지 말 것
6. worker 실행 → 원문을 **`tasks/<task>/workers/<role>/result.md`** 에 저장 (같은 워커별 폴더). **실행 전 게이트 필수**: 디스패처(`call_worker.sh`) 경유 호출은 자동. native/mcp 직접 호출(claude-main·codex MCP)은 `bash _shared/adapters/gate.sh <brief>` 를 먼저 실행해 `GATE_OK` 를 받은 뒤 호출하고, 그 줄을 `log.md` `[WORKER_CALL]` 에 함께 남긴다. 외부 쓰기(write_scope 패턴) MCP 호출은 호출 전 `bash _shared/adapters/scope_check.sh --snapshot <target_repo> > tasks/<task>/artifacts/.scope-before` → 호출 후 성공·실패 무관하게 `bash _shared/adapters/scope_check.sh <target_repo> <write_scope> tasks/<task>/artifacts/.scope-before <task>` 로 검사한 뒤 결과를 채택한다
7. `result.md`의 Verification Checklist 실행
8. 검증 결과를 `log.md`에 append (`[VERIFICATION]` 태그). 작업이 끝나면 `task.md`의 `status`를 `done`으로 갱신
9. 완료 후 교훈 추가 (분류): **시스템 운영 자체**에 대한 일반 교훈 → `_shared/learnings.md`(추적·공개). **특정 외부 프로젝트 한정**(mat·hwpx 등) → `_local/learnings.md`(git 추적 안 함, 없으면 생성). `_local/learnings.md`는 명시 요청 없이는 로드하지 않는다.

> **기존 작업 재개 시**(새 세션 포함)는 1번부터가 아니라 `_shared/orchestrator-rules.md` §3 **재진입 프로토콜**을 먼저 따른다 (재정박 → 분기 → 에러 후 진행). 재정박 첫 동작은 `bash _shared/reentry-check.sh tasks/<task>` (status↔log 정합·역할별 brief/result 표).

## Context Rules

| 파일 | 제한 (측정 가능 기준) | 목적 |
|------|------------------|------|
| `context.md` | ≤ 1500자 (한글) / ≤ 300단어 (영문) | 현재 스냅샷만. 히스토리 아님 |
| `brief.md` | ≤ 1200자 (한글) / ≤ 240단어 (영문) | worker가 실행에 필요한 것만 |
| `sources/` | 무제한 | 원본 자료. 경로로만 참조 |
| `artifacts/` | 무제한 | worker 산출물 원본 |

**측정 명령어**:
```bash
wc -m tasks/<task>/context.md   # 한글 글자수 (UTF-8 multi-byte)
wc -w tasks/<task>/context.md   # 영문 단어수
```

**context.md 초과 시**: 핵심만 남기고 나머지는 `log.md`에 append 후 초기화.  
**brief 작성 원칙**: 파일 내용을 inline 금지. 경로만 전달. 대용량 자료 동봉이 필요한 호출(예: gemini 소스 검토)은 `sources/` packet 파일 + 디스패처 payload 인자(`call_worker.sh <role> <brief> <packet>`)로 — brief 한도·inline 금지 규칙은 그대로 유지된다.

## Approval Gate

- `workers_approved`에 없는 worker 호출 금지 (claude-main 포함 전체 worker pool 적용)
- **집행**: `_shared/adapters/gate.sh`(G2 승인·G3 `[APPROVAL]` 로그·G1 brief 위치·G4 한도·G5 외부 쓰기 조건·G0 인터랙티브 세션)가 fail-closed로 판정. 디스패처는 자동, native/mcp는 호출 전 실행(Task Lifecycle 6)
- 작업당 첫 호출 전 사용자에게 확인 후 `task.md` 업데이트
- 예외: Orchestrator의 내부 추론은 worker 호출이 아니므로 승인 불필요

## Verification (결과물 수락 전 필수)

각 worker `result.md`에 포함된 Verification Checklist를 실행하고, 결과를 `log.md`에 `[VERIFICATION]` 태그로 기록.

기본 항목:
- [ ] output이 `brief.md`의 `output_format`과 일치
- [ ] 파일 경로가 실제 존재하는지 확인
- [ ] `task.md`의 constraints 충족
- [ ] Do NOT 항목 위반 없음

## log.md 규칙

- append-only. 수정/삭제 금지
- 형식: `[YYYY-MM-DD HH:MM] [ACTION] 내용`
- 기록 대상: worker 호출, 주요 결정, verification 결과, 에러

## Worker 파일 쓰기 정책

| Worker | 기본 쓰기 권한 | 외부 repo 쓰기 |
|--------|------------|--------------|
| claude-main | ❌ Orchestrator 경유 | ❌ |
| codex-main | ✅ `tasks/<task>/` 내부 산출물·diff | ⚠️ 조건부 (아래 참조) |
| codex-critic | ❌ Orchestrator 경유 | ❌ |
| gemini | ❌ MCP 응답을 Orchestrator가 기록 | ❌ |

### `write_scope` 값 정의

- `none` — 쓰기 금지 (codex-critic 등 read-only 기본값)
- `tasks-only` — `tasks/<task>/` 내부만 쓰기 (codex-main 기본 동작. 외부 repo는 안 건드림)
- `"src/**, tests/**"` 같은 경로 패턴 — 외부 repo의 해당 경로만. 아래 4조건 모두 충족 시에만 유효

### codex-main 외부 repo 쓰기 조건 (모두 충족 필수)

1. `brief.md`에 `target_repo: <절대 경로>` 명시
2. `brief.md`에 `write_scope: <허용 경로 패턴>` 명시 (예: `src/**`, `tests/**`)
3. `task.md`의 `workers_approved`에 해당 worker 항목이 있고, `write_scope`도 함께 승인됨
4. `log.md`에 `[APPROVAL]` 태그로 외부 쓰기 승인 별도 기록

위 4개 중 하나라도 누락 → `tasks/<task>/` 내부에만 산출물 작성 (diff·patch 형태 권장, 사용자가 직접 적용).

**집행**: 사전 = `gate.sh` G5 — 승인 항목의 `target_repo`·`write_scope` 값이 brief와 **정확히 일치**하고, `[APPROVAL]` 로그 줄이 같은 worker와 `write_scope` 값을 함께 담아야 통과(값이 바뀌면 재승인). 사후 = `scope_check.sh` — 실행 전후 스냅샷(상태+내용 해시) 대조로 scope 밖 변경을 **보고**(status `scope_violation`, exit 10, 자동 revert 없음 — 채택 여부는 Orchestrator 판단). `none`/`tasks-only` 는 cwd가 항상 MultiAgent 루트이고 `tasks-only` 는 현재 작업 폴더만 허용. ignored 파일·비git 대상은 검사 범위 밖(`scope_check: skipped`), 검사 자체 실패는 `scope_error`로 구분(exit 10, 폴백 없음).

직접 쓰기 가능한 worker도 `_shared/`, `_templates/`, 다른 작업 폴더는 쓰지 말 것.

## CLAUDE.md 적용 범위

이 파일은 **Claude Code를 `<설치한-폴더>/` 또는 그 하위에서 실행**할 때만 적용됨.

```bash
cd <설치한-폴더> && claude
```

다른 디렉토리에서 실행 시 적용 안 됨 (의도된 격리).  
전역 `~/.claude/CLAUDE.md`에 포함하지 말 것 — orchestration 규칙이 다른 프로젝트로 새어나감.

<!-- store:discord-bot:start -->
## 디스코드 봇 (전용 채널)

이 폴더의 세션은 discord 플러그인으로 **전용 채널**에 연결된 봇으로 뜰 수 있다.
채널에서 온 메시지는 이 세션 소관이다 — reply 도구로 답하고, 긴 작업은 진행 상황을
중간에 편집·게시한다. 전송하지 않은 텍스트는 상대에게 보이지 않는다.

### 세션 재시작 (컨텍스트가 찼을 때)
디스코드에서 사용자가 재시작을 요청하면("세션 마감하고 재시작해" 류):
1. 이 폴더의 세션 마감 규율대로 기록을 갱신한다(SESSION.md가 있으면 그 규칙, 있는
   작업 기록 프로토콜이 따로 있으면 그쪽 정본).
2. reply로 짧게 답장: 재시작 들어감 + 성패는 웹훅 알림(설정된 경우) + 재기동 후
   "이어서하자"로 재정박.
3. `bot-restart $(tmux display-message -p '#S')` 실행 — 즉시 반환되고 몇 초 뒤
   이 세션이 교체된다(재시작 작업은 tmux 서버에 위탁되므로 완주한다).

### 스레드 = 독립 세션 (라이브 뷰)
채널 아래 **스레드**의 메시지는 이 세션에 도달하지 않는다 — UserPromptSubmit 훅(bot-thread-route)이
스레드마다 전용 Claude 세션을 이 tmux 세션의 창 `t<스레드ID 끝 6자리>`에 띄우고 원문을 그쪽에 넘긴다.
그 세션의 답은 Stop 훅이 스레드에 자동 게시한다. 이 세션은 메인 채널만 담당한다.
- 메시지 앞에 `[스레드 라우팅 실패] …` 안내가 붙어 오면 그때만 실패 사실을 먼저 알리고 직접 답한다.
- "스레드 파서 해줘 / 이 건은 스레드로": `bot-thread open <봇이름> <chat_id> <이름> [message_id]`로 스레드를
  만들고, 스레드 ID를 reply로 알린다. 이후 그 스레드의 메시지는 훅이 처리한다.
- 상태 확인: `bot-thread list <봇이름>`.
- **스레드에서 있었던 일은 이 세션이 모른다**(컨텍스트 분리). 질문이 스레드 작업과 관련돼 보이거나 모르는 건이 나오면
  추측하지 말고 먼저 `threads/*/log.md`(스레드별 한 줄 요약)·`threads/*/SESSION.md`를 훑고, 부족하면
  `fetch_messages(chat_id=<스레드ID>)`로 원문을 읽은 뒤 답한다. 스레드 ID·이름은 `bot-thread list`.

**이 세션이 스레드 세션이면**(환경변수 `DISCORD_THREAD_ID`가 있다): 스레드 `$DISCORD_THREAD_ID` 전담이다.
메시지는 `<channel …>` 태그째 들어오고, 답변은 Stop 훅이 자동으로 스레드에 게시하므로 평소처럼 답하면 된다 —
reply 도구는 없다(플러그인 미탑재). 첨부는 "첨부 파일(다운로드됨)" 아래 경로로 이미 받아져 있다.
파일을 보내려면 `bot-thread post $DISCORD_BOT_NAME $DISCORD_THREAD_ID "<설명>" --file <절대경로>`.
긴 작업의 중간 보고도 같은 명령으로 직접 올린다. 메인 채널·다른 스레드 일은 이 세션 소관이 아니다.
이 세션에는 discord 플러그인이 없다(비활성) — 연결 상태·게시 성패·라우팅 로그를 답변에 언급하지 않는다.
사용자가 물은 것에만 답한다.
- **세션 이어가기 정본은 `threads/$DISCORD_THREAD_ID/SESSION.md`다.** 폴더 SESSION.md는 참고로 읽되 갱신하지 않는다
  (메인 세션 몫). 메시지 앞에 `[재정박]`이 붙어 오면 그 파일을 먼저 읽고 현재 상태·다음 단계를 복창한 뒤 이어간다.
- 컨텍스트가 차면 기본은 자동 압축(폴백). 사용자가 "세션 마감하고 재시작해"라고 하면: ①`threads/$DISCORD_THREAD_ID/SESSION.md`
  증분 갱신(없으면 폴더의 SESSION.template.md를 복사, 그것도 없으면 목표/현재 상태/다음 단계/결정 기록/파일 흔적 5절로 생성)
  ②이 스레드의 결론 중 메인 작업의 전제가 될 것이 있으면 폴더 SESSION.md **결정 기록에 한 줄만** 추가(허용된 유일한 폴더 SESSION.md 갱신)
  ③`bot-thread post $DISCORD_BOT_NAME $DISCORD_THREAD_ID "재시작 들어감 — 다음 메시지부터 새 세션이 기록을 읽고 이어갑니다"`
  ④`bot-thread rotate $DISCORD_BOT_NAME $DISCORD_THREAD_ID`. 이 세션은 곧 닫힌다.
  **스레드 회전에는 웹훅 알림이 없다** — ③의 게시가 완료 신호다. 웹훅을 안내하지 마라.

### 주의
- 이 폴더에서 로컬 터미널 세션과 봇 세션을 병행하면 같은 SESSION.md를 공유한다 —
  **마감 주체는 한 세션만**. 양쪽에서 마감하면 늦게 쓴 쪽이 이긴다.
- 채널 밖(다른 채널·DM)의 지시는 처리하지 않는다.
- **다른 사람이 함께 있는 채널**: 전용 채널은 사용자의 모든 메시지가 이 세션으로
  오지만 수신인이 누구인지는 알려주지 않는다. 메시지에 `<@…>` 사용자 멘션이
  포함돼 있으면 그 사람에게 하는 말이다 — **응답·조회·도구 실행을 전부 하지
  않는다**(봇에게 시킬 일은 멘션 없이 쓴다). "OO한테 말한 거임" 류로 수신인이
  명시된 메시지도 처리하지 않는다.
<!-- store:discord-bot:end -->

<!-- store:project:start -->
<!-- 프로젝트 지침 블록. store 마커 안에 두어 multi-agent-starter 재설치·업데이트 때도 재부착된다. 수정은 이 블록 안에서만. -->
## 프로젝트: MES Agent Hub (mes-assistant-platform3)

위 MultiAgent 규율(승인 게이트·라이프사이클·검증)은 그대로 적용한다. 이 블록은 **무엇을 만드는지**만 정의한다. 충돌하면 위 규율이 이긴다.

### 한 줄 정의
사내 AI 에이전트(OpenWebUI assistant)를 카드로 골라 대화하고, 대화끼리 태그로 느슨하게 이어 **파일과 대화를 주고받는 업무 플랫폼**의 **실제 제품 구현**.
데모(`mes-assistant-platform2`, 태그 `demo-final`)에서 검증된 동작을 서버 기반으로 옮기는 것이 원칙이다.

### 정본 문서 (이 순서로 읽고, 요약하지 말고 경로로 참조)
1. `docs/next-project/PRD.md` — 역할·권한, 화면, 기능 요구사항(FR), 확정 정책(D18), 비기능, 범위
2. `docs/next-project/architecture.md` — 스택(D20), 저장소 구조, **데모 소스 재사용 지도(§3)**, SSO(D21), 착수 순서(§9)
3. `docs/next-project/openapi.yaml` · `docs/architecture/data-contract.md` · `apps/api/src/db/schema.ts`(DDL 정본, `postgres-draft.sql`은 전환 전 기록) · `docs/next-project/db-mariadb-plan.md` §3(DB 규칙) — API·데이터 계약·DDL
4. `docs/fusion-design.md` · `docs/evaluation/context-flow.md` — 참조 대화·요청 트레이·전달 실패 설계 근거와 회귀 기준
5. `docs/HANDOFF.md` — 결정 로그 D1–D21, 원칙(§2), 함정(§7)
- 문서끼리 어긋나면 **번호가 큰 결정(D)이 우선**. 그래도 불명확하면 추측하지 말고 사용자에게 묻는다.
- HANDOFF의 Windows·PowerShell·`%TEMP%`·설치된 Edge 관련 메모는 데모 환경 기준이다 — 이 저장소는 macOS에서 개발한다.

### 깨면 안 되는 원칙 (상세: HANDOFF §2)
- 플랫폼 ≠ 워크플로우: 업무 절차는 assistant 안에 있다. 플랫폼은 흐름을 지시하지 않는다.
- 대화 1개 = 업무 1개, 첫 전송·첨부 때 생성(지연 생성).
- 태그로 느슨하게 연결. 같은 태그를 **직접** 공유하는 대화의 파일·대화가 후보로 보이고, **사람이 고른 것만** AI로 간다(간접 확산·자동 교체 없음).
- 보낸 것 = 본 것: 트레이 추정과 실제 전송은 같은 조립 함수. **자동 절단·자동 요약 금지**, 한도 초과면 전송을 막는다.
- 요청은 서버 RequestService만 보낸다(대화당 진행 중 1건, 생존 신호·정리·재시도).
- OpenWebUI는 API + 링크만, **서버가 대리 호출**하고 키는 서버 비밀 저장소에만 둔다. 에이전트 관리·전역 설정은 System Owner만(서버 강제, D19).
- 업무 절차 프롬프트를 플랫폼에 넣지 않는다. 순서 기반 인계·자동 절단·자동 요약·재귀 수집 금지.
- 파일은 디스크·NAS에 파일 그대로 보관, DB에는 메타데이터와 `storage_key`만.
- 역할(담당자·System Owner·요청자)은 앱이 관리하고 서버가 강제한다.

### 스택·구조 (D20·D21)
- **pnpm** 모노레포: `apps/web`(React 19 + Vite + shadcn/ui, 데모 화면 이식) · `apps/api`(NestJS, Node 22) · `packages/domain` · `packages/llm` · `packages/contracts`(zod → OpenAPI) · `e2e/` · `docs/`
- MariaDB(단독 설치, 기준 11.8 LTS·호환 하한 10.4, D40) + Drizzle(`mysql2`) · TanStack Query + SSE · vitest + Playwright
- 개발 환경: Docker Compose(MariaDB · Keycloak(SSO 대역) · 가짜 OpenWebUI). 인증은 사내 SSO(OIDC/SAML) **수신 측만** 구현, 역할은 앱이 관리.

### 크로스플랫폼 원칙 (최종 실행 환경 = Windows, 개발 = macOS — S0부터 적용)
- Docker는 개발용 의존 서비스(MariaDB·Keycloak·가짜 OpenWebUI)에만 쓴다. api·web은 Docker 없이 Windows에서 Node로 직접 빌드·실행 가능해야 한다. 운영 배포(Windows 서비스 네이티브 / 컨테이너)는 S5에서 정하고, 그 전까지 둘 다 가능하게 둔다. compose는 OrbStack 전용 기능 없이 Docker Desktop(Windows)에서 그대로 돌아야 한다.
- package.json 스크립트에 bash 문법·`rm -rf`·`export`·`VAR=값` 접두 금지 → node 스크립트·cross-env·rimraf. 개발 흐름에 `.sh` 필수 단계 금지(컨테이너 내부 스크립트는 예외).
- 경로는 `path.join`/`path.resolve`만. 파일 `storage_key`는 OS 무관 `/` 구분 상대 키, 실제 경로 변환은 `FileStorageService` 한 곳에서만(드라이브·UNC 대비). 파일명에 Windows 금지 문자·예약어 금지.
- `.gitattributes`로 LF 정규화. import 경로 대소문자는 실제 파일명과 정확히 일치.
- 네이티브 빌드 npm 패키지는 피하고, 불가피하면 Windows 사전 빌드 여부를 확인해 사용자에게 알린다.
- CI는 ubuntu-latest·windows-latest 두 곳에서 typecheck·test·lint. E2E의 Windows 실행은 S1 이후.

### 데모 소스 재사용
- 데모 저장소: `~/workspace/github/work/mes-assistant-platform2` — **읽기 전용 참조. 절대 수정·커밋하지 않는다.**
- 옮길 때는 architecture §3 재사용 지도를 따른다(도메인 규칙은 거의 그대로, `db` 직접 조회는 저장소 인터페이스 주입으로, `useLiveQuery`는 TanStack Query로).
- 워커 brief에는 데모 파일 **경로**를 적는다(내용 inline 금지 — 위 Context Rules).
- **이식 원칙**: 기능을 옮길 때는 데모 소스를 직접 열어 동작·엣지케이스를 확인하고, 데모 테스트가 있으면 **먼저 이식해 통과**시킨 뒤 구현한다. 요약 문서(HANDOFF·PRD 등)만 보고 재구현하지 않는다. 목표는 데모 기능 100% 수용(명시적으로 제외한 것만 빼고) — 대응표 정본 `docs/next-project/parity-matrix.md`.

### 워커 실행 규칙 (이 프로젝트)
- 디스패처를 우회해 워커를 직접 실행하면 출력을 `tasks/<task>/artifacts/<role>.stdout.log`에 남기고, 시작·종료를 디스코드 채널에 한 줄씩 알린다(agentlayer에 안 보이므로).
- gemini(agy) 모델: 전역 기본 `gemini-3.8-flash-high`. 긴 문서·제3자 검토처럼 Pro가 필요한 호출은 `--model gemini-3.1-pro-high`를 호출별로 붙인다(최신 agy는 `--model` 지원 — `_shared/routing.md`의 "per-call 핀 불가·전역 pro-high"는 옛 정보, 이 규칙이 우선).

### 진행 방식
- 스프린트 = architecture §9의 S0–S5. 태스크 폴더는 `tasks/s<N>-<주제>/`. 각 스프린트의 **완료 기준**이 Verification의 기준이다.
- 현재 위치: **S0·S1·S2 완료(`main` 병합, 태그 `s0-done`·`s1-done`·`s2-done`), S3 ① 요청 서비스 완료(`main` 병합), DB 엔진 MariaDB 전환 완료(D40, 태그 `db-mariadb-done`, 되돌림 기준 `pre-mariadb`) → 다음 S3 ② 참조 대화 → ③**. 기록: `tasks/s0-skeleton/`·`tasks/s1-*/`·`tasks/s2-*/`·`tasks/s3-request/`·`tasks/db-mariadb/`, `docs/HANDOFF.md` 6장. S3 계획: `docs/next-project/S3-kickoff.md`·`S3-design.md`(D39). 이월: OpenAI 실키 확인·Windows 실기 확인(S1), U9 링크 규칙·KI-7(S4).
- S1의 실환경 확인(`docs/evaluation/real-env-verification.md`)은 **이 환경에서 불가(D31)** — 사용자가 사내에서 수행. 개발은 가짜 OpenWebUI + OpenAI 호환 API 전환 프리셋으로 진행하고, 사내 연동 결과가 오면 어댑터를 맞춘다.
- 확정: 배포 Windows 서버(D32) + **MariaDB 단독 설치(D40)**, 이번 페이즈 SSO 미연계 → **앱 자체 로그인**(D34), 병렬 단계·상태는 **코드 데이터로 관리**(D35). 남은 확인: OpenWebUI 버전, 비기능 제안값(PRD §6).
- 스프린트가 끝나면 이 블록의 "현재 위치"와 아래 "명령"을 갱신한다.

### 작업 방식 (사용자 지시 — 매 세션 적용)
- 오케스트레이터(이 세션)는 계획·판단·통합·검증·소통만 한다. **구현은 워커에 위임**(codex-main·claude-main) — 작업 단위와 write_scope를 좁혀 승인을 요청하고, 결과는 테스트·scope_check로 검증한 뒤 `[VERIFICATION]`을 기록한다. 문서·기록 갱신은 오케스트레이터가 직접 한다.
- 시작 전에 이번 세션 계획(파일 구조와 순서)을 보여 주고 **승인을 받는다**(워커셋·write_scope 승인과 함께).
- 스프린트마다 계획 → 승인 → 워커 위임 → 검증 → 대응표(`parity-matrix.md`) ✅ 갱신 → 사용자 확인. **매 보고에 대응표의 남은 항목 수(⬜)를 적는다.**
- 기능 브랜치(`feat/*`)에서 작업, **테스트를 먼저** 쓰고, 단계별로 **작게 커밋**한다. push와 `main` 병합은 **D42 규칙**: 로컬 검증 + CI 전 잡 녹색이면 자동(`--no-ff`), 사후 보고. 녹색이 아니면 병합하지 않는다.
- 사용자 판단이 꼭 필요한 결정만 선택지로 질문한다. 나머지는 합리적인 기본값으로 진행하고 알려 준다.
- 세션이 끝나면 `docs/HANDOFF.md`에 상태·결정·다음 단계를 기록한다.

### 워커 쓰기 범위 (외부 쓰기 승인 시 기본 제안값)
- `target_repo`: 이 저장소 루트. 제안 `write_scope`: `apps/**`, `packages/**`, `e2e/**`, `docker/**`, 루트 설정 파일(`package.json`, `pnpm-workspace.yaml`, `tsconfig*.json`, `docker-compose*.yml`, `.github/**`) — 태스크별로 좁혀서 승인받는다.
- `CLAUDE.md`, `_shared/**`, `_templates/**`는 워커 쓰기 범위에 넣지 않는다. `docs/**`는 README·HANDOFF 작성 태스크에서만 해당 파일로 좁혀 승인받는다.

### 명령 (S0 확정 — 상세는 README)
- 설치 `pnpm install` · 환경 `pnpm setup:env` · 의존 서비스 `docker compose up -d --wait`(MariaDB·가짜 OpenWebUI; Keycloak은 `--profile oidc`)
- 개발 서버 `pnpm dev` (api :3000 · web :5173, 첫 화면 회원가입 → `INITIAL_SYSTEM_OWNERS`=`dev-owner`로 가입하면 SO) · 빌드 `pnpm build`
- typecheck `pnpm typecheck` · 린트 `pnpm lint` · 단위 `pnpm test` · DB 통합 `pnpm test:db` · E2E `pnpm test:e2e`
- DB 마이그레이션 생성 `pnpm --filter @mes/api db:generate` · 적용 `pnpm db:migrate` · 개발 시드 `pnpm db:seed`(운영 거부)
- Node는 22 고정(mise·`.nvmrc`) — 이 Mac에서는 `mise exec -- pnpm …`

### git 관리 기준 (정본: `docs/git-policy.md`)
- `main`은 항상 동작. 작업은 `feat/*`·`fix/*`·`docs/*`·`chore/*`. 병합은 **merge commit(`--no-ff`)**, squash 금지. 스프린트 병합 뒤 태그 `s<N>-done`.
- Conventional Commits(`feat:` `fix:` `docs:` `test:` `refactor:` `chore:`), 작게·한 커밋 한 목적. `pnpm-lock.yaml`은 항상 커밋, 의존성 변경은 별도 커밋.
- 병합 조건: CI(ubuntu+windows) 녹색 + 테스트 통과. push·`main` 병합은 D42 규칙(자동, 사후 보고). 사용자가 미리 보겠다고 한 건은 승인 뒤.
- 커밋 금지: `.env`·키·토큰, 사내 주소·실명·사내 자료, 로컬 산출물(node_modules·dist·.pnpm-store·로그·스크린샷). 커밋 전 git-policy §6 점검.
- 설치 가이드 `docs/setup/windows.md`(기준)·`macos.md`: 명령이 바뀌면 **같은 커밋에서** 갱신. ` ```powershell ci ` 블록은 CI `setup-guide` 잡이 그대로 실행한다.

### 공개 저장소 규칙 (GitHub PUBLIC — HANDOFF §7)
- 사내 주소·사내 AI 포털 주소·양식 번호·참고 이미지·이미지에서 옮긴 문구·실명 추가 금지(시드·테스트는 가상 데이터). 비밀값(키·client secret·`.env`)은 커밋하지 않고 `.env.example`만 둔다.
- 커밋 전 `git grep`으로 민감 문자열 점검. `feat/*` 브랜치 커밋은 자유, **push·`main` 병합은 사용자 승인 후에만.**

### 이 봇 자신의 멘션 (디스코드)
- 이 봇 자신의 사용자 ID는 `CLAUDE.local.md`(git 무시)에 있다. 메시지에 그 멘션만 있으면 사용자가 봇을 부른 것이므로 평소처럼 응답한다.
- 위 "다른 사람이 함께 있는 채널" 규칙은 이 봇 **이외의** `<@…>` 멘션에만 적용한다.
<!-- store:project:end -->
