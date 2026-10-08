# Shared Learnings

작업 완료 후 재사용 가능한 교훈만 추가. append-only.  
중복·일회성·작업 특화 내용은 기록하지 말 것.

## 분류 규칙 (어디에 적을지)

- **시스템 운영 자체**에 대한, 어떤 작업에든 적용되는 교훈 → **이 파일** (`_shared/learnings.md`, git 추적·공개).
- **특정 외부 프로젝트/repo에 묶인** 교훈(예: mat·hwpx 내부) → **`_local/learnings.md`** (git 추적 안 함·미배포. 없으면 새로 생성. 오케스트레이터는 명시 요청 없이는 로드하지 않음).

## 형식

```
## [YYYY-MM-DD] [작업명]
**교훈**: 한 문장. 다음 작업에 그대로 적용 가능한 형태로.
**근거**: 왜 그런지, 어떤 작업에서 발견했는지.
**worker**: [관련 worker명]
```

---

<!-- 이 아래부터 교훈 추가 -->

## [2026-05-13] [mat-mvp]
**교훈**: orchestrator-cwd가 git이 아니면 Task tool sub-agent 호출에서 worktree 격리가 실패할 수 있다. 다른 git repo를 다룰 때는 그 repo로 `cd` 후 claude를 시작하거나, worktree를 요구하지 않는 일반 에이전트로 폴백.
**근거**: claude-test(비-git) cwd에서 `subagent_type: claude` 호출 시 "Cannot create agent worktree" 에러. `general-purpose`로 재시도하니 격리 없이 성공.
**worker**: claude-main 호출 경로

## [2026-05-14] [mat-mvp]
**교훈**: `task.md`는 ` ```yaml ` 블록을 2개 갖는 게 표준 패턴(메타 + Worker Plan)이다. 어떤 키든 첫 yaml fence만 보는 파서는 깨진다 — 문서 전체의 모든 yaml block을 스캔하도록 작성할 것.
**근거**: mat의 `readPlannedWorkers`가 첫 fence 닫는 ``` 에서 return하는 바람에 `planned_workers`(두 번째 블록)를 못 봤다. codex-critic이 MAJOR로 잡고 fix iter로 수정.
**worker**: codex-critic (지적), claude-main (수정)

## [2026-05-14] [mat-mvp]
**교훈**: 같은 worker의 재호출(fix iter)은 별도 폴더 만들지 말고 같은 worker 폴더 안에서 `brief-fix.md` / `result-fix.md` 명명으로 진행. 1차 산출물·승인 기록을 보존하면서 변경 이력이 시각적으로 드러난다.
**근거**: codex-critic 리뷰 후 claude-main에 MAJOR 2건 패치 재호출 시 적용. `workers_approved`는 그대로 두고 brief/result 한 쌍을 추가하는 것만으로 충분했고 깔끔했다.
**worker**: claude-main (fix iter)

## [2026-05-14] [yt-thumbnail-multiagent]
**교훈**: MultiAgent 작업은 worktree 진입 금지. orchestration 산출물(`tasks/<task>/`)은 gitignore라 worktree에 만들어도 본체로 옮기려면 수동 복사 사족이 생긴다. tracked 시스템 파일도 단순 append/수정에 worktree+commit+merge는 과한 오버헤드.
**근거**: 배경 세션 harness가 자동으로 EnterWorktree를 강제해 task 폴더와 시스템 파일 수정 양쪽에서 `cp -R` 또는 머지 사족이 발생했다. 외부 `target_repo` 쓰기는 codex-main의 cwd로 따로 격리되므로 MultiAgent repo 자체에 워크트리는 불필요. 인터랙티브 세션에서는 EnterWorktree를 자발적으로 호출하지 말 것.
**worker**: orchestrator (세션 초기화 시 EnterWorktree 호출 안 함)

## [2026-05-14] [yt-thumbnail-spring]
**교훈**: log.md는 표준 형식 엄수 — (a) 태그는 정해진 6종(`DECISION | WORKER_CALL | VERIFICATION | ERROR | APPROVAL | COMPLETE`)만 사용, (b) 타임스탬프 `[YYYY-MM-DD HH:MM]`까지 기록, (c) 작업 완료 시 마지막 줄에 `[COMPLETE]` 엔트리 필수.
**근거**: yt-thumbnail-spring log에서 `INIT/BRIEF/CALL/RESULT` 새 태그 사용, HH:MM 누락, [COMPLETE] 부재. mat 같은 도구가 표준 형식 가정하고 파싱하면 일관성 깨짐.
**worker**: orchestrator (로그 작성 규율)

## [2026-05-15] [hwpx-math-final]
**교훈**: codex MCP 호출이 비정상적으로 길어질 때(>2-3분) 첫 의심은 외부 MCP 도구 hang이지 모델·reasoning이 아니다. `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`의 event timestamp gap을 보면 어느 function_call에서 막혔는지 즉시 식별 가능.
**근거**: 표면 원인(reasoning=high, brief 길이, AGENTS preamble)으로 잘못 짚었다가 사용자 재질문 후 turn timing 분석으로 진단. 탐색·normalize는 50초, hang난 function_call→output 사이가 399초로 명확. session jsonl이 정답지.
**worker**: orchestrator (디버깅 절차)

## [2026-05-15] [hwpx-math-final]
**교훈**: `mcp__codex__codex`의 reject 응답이 codex backend 작업을 중단시키지 않는다. 사용자 거부 후에도 backend는 끝까지 실행되어 파일·부수 효과가 남을 수 있음. 거부한 호출 직후엔 대상 디렉토리 상태를 반드시 확인.
**근거**: reject된 codex MCP 호출 두 건이 backend에서 작업을 계속해 cwd에 산출 파일 생성. orchestrator는 처음에 그 파일들이 어디서 왔는지 추적 못 함. `~/.codex/sessions/` 세션 jsonl로 확인 가능.
**worker**: orchestrator (MCP reject 의미 이해)

## [2026-05-15] [manual-final-review]
**교훈**: `mcp__gemini-pro__*`(로컬 프록시 기반 gemini-pro 브리지)가 `Proxy 400 INVALID_ARGUMENT`를 내면 프롬프트 크기 문제가 아니라 모델 티어 문제일 수 있다 — 압축 재시도로 시간 쓰지 말고 폴백 순서를 `pro-high → pro-low(같은 프록시, 종종 정상) → Flash 브리지`로 단계 강등하라. 어느 경우든 model deviation을 result.md·리포트에 명시한다. gemini는 FS 접근이 없어 brief "경로 참조"가 안 통하므로 필요한 자료는 orchestrator가 MCP prompt에 직접 inline하고 그 사실을 brief·log에 적는다. FS 미접근 모델이 낸 *시스템 사실 주장*은 codex-critic/권위문서로 교차검증 후에만 채택한다(never-trust-upstream — 리뷰어 출력에도 동일 적용).
**근거**: pro-high가 큰/압축 프롬프트 모두 동일 400. Flash는 1회 성공했으나 문서 우선순위를 오추정, 같은 프롬프트로 pro-low는 정상 동작하며 더 날카로운 비평을 냈다(같은 프록시인데 pro-high만 막힘). pro-low조차 매뉴얼 용도(런타임 미적재 사람용 문서)를 오판해 "이론=토큰낭비"라는 틀린 전제로 소절 삭제를 권고 → 사실검증으로 불채택했다.
**worker**: gemini (프록시 장애·FS 미접근), codex-critic (사실 교차검증), orchestrator (폴백 강등·리뷰어 출력 검증)

## [2026-05-19] [repo-consistency-audit]
**교훈**: 다중 repo 일관성 감사에서 claude-main·codex-main을 **추상화 레이어로 분담**시키면(claude-main=의미·규칙 레벨, codex-main=파일·파서·코드 레벨) 같은 입력 중복 호출 대신 상호보완 커버리지가 나온다 — 이번에 codex만 검출(표준 brief→mat 파서가 worker 목적을 ` ```yaml `로 표시)·claude만 검출(manual↔mat 상태 우선순위 순서/단계 불일치)이 각각 진성 크리티컬이었고 둘 다 독립 검출한 항목(gemini 기본 모델 pro-high 충돌)은 신뢰도 최상으로 분류. 병렬 brief에 "다른 worker 결과 미참조" 명시는 codex result checklist에 그대로 확인됨. 또한 claude-main이 초기 가설 2건을 self-retract했어도 orchestrator가 인용 라인을 sources에 **직접 재대조**(never-trust-upstream을 worker 출력에도 적용)해야 false-positive·false-negative 둘 다 막힌다.
**근거**: 단일 worker였으면 크리티컬 3건 중 1건씩 누락. orchestrator 재검증에서 firstMeaningfulLine(task.go:499)·.mcp.json·routing.md:111을 직접 확인해 codex/claude 주장과 retraction을 모두 사실검증 후 취합.
**worker**: claude-main(의미·규칙 레이어), codex-main(파일·파서 레이어), orchestrator(레이어 분담 설계·인용 직접 재대조·취합)

## [2026-05-25] [autokakao-dup-guard]
**교훈**: 안전장치 코드의 codex-critic 비평을 반영할 때, Orchestrator가 비평을 **직접 재현 검증**하면(순수함수=단위테스트로, 구조적 결함=정적 grep/인덱스 비교로) 2차 worker 검수 호출 없이도 루프를 신뢰성 있게 종료할 수 있다 — 비평 맹신·맹기각 둘 다 회피. 이번엔 #3(정규화 충돌 `verify_room('스터디 2','스터디')=True`)을 단위로, #2(제목 후보 수집범위=메인창 전체→거짓양성)·#1(Enter가 포커스검증보다 먼저)을 정적으로 재현해 진성임을 확정하고, v2도 같은 방식으로 재검증(9케이스+정적 8항목 PASS) 후 사용자가 2차 검수 대신 수락. 더불어 안전장치는 **미확정 의존성(여기선 열린 방 헤더 AX 위치)을 파라미터+TODO로 외부화하고 미설정 기본값을 fail-closed**(전부 거부)로 두면, 라이브 검증 전 단계에서 절대 오발송이 안 나는 안전한 중간 산출물이 된다.
**근거**: codex High 3건이 모두 진성이었고 Orchestrator 재현으로 확정. read_open_room_title이 expected와 일치하는 후보를 메인창 어디서든 신뢰하던 v1은 "거짓 음성 방향" 주장과 달리 거짓 양성(오발송) 경로였음 — worker 자기평가도 never-trust-upstream로 교차검증해야 함. v2는 HEADER_* 미설정=항상 None=fail-closed로 안전하게 게이트.
**worker**: claude-main(구현·v2 반영), codex-critic(High3 비평), orchestrator(비평 직접 재현검증·fail-closed 수락 판단)

## [2026-05-25] [autokakao-jobs-demo]
**교훈**: 외부 GUI 자동화에서 "설계 단계의 가정"은 **라이브 테스트 전까지 미검증**으로 취급하라. 동명이인 안전장치를 브레인스토밍 때 전략 A(열린 방 헤더 제목 읽기)로 골랐지만, 라이브 probe 결과 KakaoTalk이 단일 창이라 헤더가 구분 가능한 AX 요소로 노출되지 않아 A는 원천 불가였다. 진짜 해법은 라이브 probe가 알려줬다 — ⌘F 검색 결과 셀(AXCell)의 `AXSelected`로 하이라이트를 읽어, room_title과 정확 일치하는 결과가 선택될 때까지 ↓ 후 Enter(전략 B). "첫 결과 ↓1회+Enter"는 '테스트' 검색이 '테스트1234'를 먼저 열어 오발송함을 라이브로 실증. 즉 GUI 자동화는 (1) 설계 가정에 과투자 말고 빨리 라이브 probe로 실제 AX 구조를 확인하고, (2) 안전장치는 '열고 나서 검증'(abort만 가능)보다 '정확한 대상을 애초에 선택'(B)이 더 강하다.
**근거**: 헤더 probe가 메인창 단일 창만 찾고(별도 창 없음) 열린 방 제목을 단일 요소로 못 줌. 반면 검색결과 probe에서 ↓1=테스트1234 selected, ↓2=테스트 selected가 깔끔히 노출돼 전략 B가 바로 구현됨. staging→--send 2/2 성공.
**worker**: orchestrator(라이브 probe·전략 전환·전략 B 구현), gemini(영수증·회의록 비전 정리)

## [2026-06-01] [harness-vup-reentry]
**교훈**: 외부 레퍼런스(harness)를 시스템에 도입하는 v-up에서, 6패턴을 통째로 받지 말고 **이 시스템 불변식으로 환원되는 것만 흡수하고 충돌하는 것은 "배제 근거를 design-basis(D6)에 명문화"**하는 방식이 정체성을 지킨다 — Pipeline/Fan-out·in/Expert Pool/Producer-Reviewer는 흡수(대부분 기존 암묵 구현, Fan-in 충돌해소만 신규), Supervisor·Hierarchical은 단일 orchestrator·worker간 무통신·file-as-memory와 충돌해 배제. codex-critic adversarial 리뷰가 진성 결함 2건(치명)을 잡음: ①재진입 분기를 result.md 유무로만 판단하면 status=waiting_<role>·늦은 응답·status↔log 불일치·외부 write_scope 재승인을 놓침 → 재정박에 brief+status 추가·분기 확장으로 해소, ②신설 불변식(INV11)의 grep이 `grep -lin`이라 "둘 중 하나만 맞아도 통과" → per-file `grep -q`+4패턴 positive+배제 negative check로 자동 FAIL 판정 가능하게 교정. 배제 근거 문구도 "Supervisor 개념 배제"가 아니라 "기존 orchestrator 위에 별도 long-lived 조정자/재귀 위임 **계층 추가**를 배제"로 정밀화해야 정확(orchestrator 자신이 이미 중앙 조정자이므로).
**근거**: orchestrator가 critic ISSUE 6건을 사실검증(never-trust-upstream을 리뷰어에도 적용) → #3만 PASS, 5건 진성 → 전부 반영. 자가점검 INV11a/b/c 신규 PASS, INV1~10 회귀 없음. 새 상시로드 비용은 CLAUDE.md 1줄 포인터뿐, 본문은 orchestrator-rules(온디맨드)·routing(라우팅시)·design-basis/invariants(게이트)에 배치.
**worker**: orchestrator(흡수/배제 설계·라이브 파일 편집·ISSUE 사실검증·자가점검), codex-critic(변경안 adversarial 리뷰 5 ISSUE)

## [2026-06-01] [model-policy-cleanup]
문서 일관성 변경(예: 모델 버전 문자열 → 별칭화)은 "정책 섹션"만 고치면 안 된다. 같은 식별자가 워커 상세·비용 설명·예시 등 여러 위치에 흩어져 있어, 한 곳만 바꾸면 같은 파일 안에서 정책↔본문이 모순된다. codex-critic이 routing.md의 잔존 핀(:62 claude-opus-4-7, :65 Opus 4.7, :120 gpt-5.4-mini)을 잡았다. → 표기 정책을 바꿀 땐 `grep`으로 그 식별자의 전 등장 위치를 먼저 훑고 일괄 처리할 것. 또한 "결정적/영속" 같은 단정어는 환경 설정(config·env·profile)으로 바뀔 수 있는 값엔 과장이므로 피한다.

## [2026-06-02] [gemini-backend-agy]
"pro-high 쓰지 마라"(D4/INV9) 같은 **환경 한계발 금지 규칙**은 그 환경(백엔드)이 바뀌면 근거가 사라진다. pro-high 제외 사유는 옛 antigravity-claude-proxy의 `400 INVALID_ARGUMENT`였는데, 백엔드를 `agy` CLI로 바꾸니 pro-high가 정상 작동(spike 실증). → 금지 규칙엔 **"무엇 때문에 금지인지(원인 계층)"를 함께 적어야**, 원인이 사라졌을 때 안전하게 해제할 수 있다. 또 모델 셀렉션이 도구마다 다름을 확인: agy는 모델이 **전역·계정단위**(`/model`)라 per-call 핀 불가 → worker별 다른 모델 동시 사용은 안 되고, gemini 전용 전역을 pro-high로 고정해 운용. 마이그레이션은 D4·INV9·INV10·routing·validate C6를 **한 묶음으로** 갱신해야 내부 모순(validate가 새 정본을 FAIL)이 안 생긴다.
**근거**: agy spike S1 GREEN + 3자 검수(codex #8이 "옛 정책과 충돌" 지적 → 검증하니 정책을 갱신해야 하는 것이었음). backends.json이 gemini 호출 정본, mcp__gemini-pro__/mcp__gemini__ 브리지 폐기.
**worker**: orchestrator(마이그레이션·라이브 편집), codex-critic+gemini=agy(검수)

## [2026-09-28] [verify-without-local-services]
워커 결과를 Orchestrator가 로컬에서 재실행해 "전부 통과"로 수락했는데 CI(DB 잡·Windows 잡)에서 실패했다. 원인은 새 계약 테스트가 로컬 compose에 떠 있던 가짜 OpenWebUI(localhost:3101)를 하드코딩한 **환경 의존** — 로컬엔 그 서비스가 늘 떠 있어 검증이 잡지 못했다. → 외부 서비스에 닿는 테스트를 워커가 추가했으면, 수락 전에 **그 서비스를 내린 상태로 한 번 더 돌리거나**(`docker compose stop <svc>`) CI 잡 정의(무엇이 있고 없는지)와 대조한다. 명세 단계에서도 "테스트는 자기 의존을 스스로 띄운다(임시 포트 spawn)"를 완료 기준에 넣는 것이 더 싸다. 같은 날 앞선 사례: Windows CI에서 psql이 비밀번호 프롬프트로 33분 정지 — 로컬(mac PowerShell)에서 통과한 문서 명령이 러너 환경(action이 PG* env 덮어씀)에서 다르게 동작. 둘 다 "로컬에서 통과 = 어디서나 통과"가 아니라는 같은 교훈.
**근거**: s1-llm-proxy CI run 36359746974 실패 → 3차 워커로 테스트가 server.mjs를 임시 포트에 spawn하도록 수정 → compose 정지 상태 15/15 통과. s0 setup-guide 잡은 스텝 env PGPASSWORD 재지정으로 해소.
**worker**: orchestrator(원인 분석·명세), codex-main(수정), codex-critic(이 회귀는 리뷰 관점 밖이었음 — 리뷰 brief에 "CI 잡 환경에서 실행 가능한가"를 관점으로 추가할 것)
**추가(같은 날, S2 ③)**: 세 번째 변종 — 3 MB Buffer를 vitest `toEqual`로 비교하는 테스트가 로컬 0.3초·CI 러너 10–15초(기본 timeout 5초 초과). "환경 의존"에는 서비스 유무뿐 아니라 **속도**도 들어간다. 큰 바이너리는 `Buffer.equals`/길이 비교, 무거운 테스트는 명시 timeout. 리뷰 brief 관점 (5) "CI 환경"에 시간 제한도 포함.

## [2026-10-01] [gate-before-launch-chaining]
게이트가 거부(brief 한도 초과)했는데 워커가 그대로 실행됐다. 게이트 실행과 워커 실행을 한 명령 안에서 `;`로 이어 써서, 게이트의 실패 종료 코드가 다음 단계로 전달되지 않았다. 읽기 전용 호출이라 피해는 없었고 즉시 중단·재게이트했다. → 게이트 결과를 변수로 받고 **`&&`로만 잇는다**(`G=$(gate.sh brief) && … && 실행`). `[WORKER_CALL]` 로그 줄도 게이트 통과 뒤에만 쓴다. 디스패처를 우회해 직접 실행할 때 특히 주의
**근거**: db-mariadb G5 리뷰 호출 — 로그의 `[ERROR] 정정` 줄
**worker**: orchestrator
**추가(같은 날, s4-admin 재개 호출)**: 변종 — `G=$(gate) && … && cat >> log <<EOF … EOF` 다음 줄에 실행 명령을 두면 heredoc이 끝나는 순간 체인이 끊겨 게이트 실패에도 실행된다. 게이트 → 로그 → 실행을 **한 줄의 && 체인**으로, 로그는 heredoc 대신 `printf`로. 실행 뒤 `pgrep`으로 프로세스 cwd까지 확인

## [2026-10-01] [engine-port-by-tests]
DB 엔진을 바꿀 때 "문법 번역"보다 **기존 테스트를 새 엔진으로 먼저 옮겨 실패시키고 통과시키는** 순서가 빨랐다(기반 → 리뷰 → 서비스 → 리뷰). 단독 검증으로 잡은 것: 하위 버전에서 json이 문자열로 읽힘(두 버전을 같이 돌려야 보인다), 컬럼 길이와 서비스 허용 길이 불일치. 리뷰어가 잡은 것: 선택한 정렬이 끝 공백을 무시. → 엔진·버전 호환을 목표로 하면 **하한 버전 컨테이너를 처음부터 같이 띄워** 매 관문에서 두 번 돌린다. 전환 전 스키마의 구조 기준선(테이블·컬럼·제약 개수)을 먼저 떠 두면 대조가 기계적으로 된다
**근거**: db-mariadb G1(10.4에서 1건 실패 → 수정), G2(11.8·10.4 각 85건)
**worker**: orchestrator(계획·검수), codex-main(구현), codex-critic(스키마·코드 리뷰)

## [2026-10-02] [e2e-flake-triage]
E2E 플레이크는 세 갈래로 나눠 본다. ① 전역 대기 부족 — spec이 늘어 병렬 부하가 커지면 5 s 기본 `expect`가 mock 스트리밍·목록 로드에 부족해진다 → spec마다 땜질하지 말고 설정 `expect.timeout`을 올린다. ② 앞선 실패가 남긴 데이터 — 정리(finally) 블록이 타임아웃으로 안 돌면 다음 spec이 연쇄 실패한다 → 재실행 전에 DB 잔존을 확인·삭제. ③ 제품 결함 — trace.zip의 `*.trace`를 파싱해 느린 action과 마지막 log 줄을 보면 locator가 "해결되지 않음"으로 멈춘 지점(로드 전 클릭 같은 진짜 경합)이 드러난다.
**근거**: s4-system-assistant — admin 60 s 타임아웃 2/3 재현 → trace로 "순서 편집 → draggable 0개" 확인(제품 결함 1줄 수정) · S8·E6는 대기 부족 → expect 15 s 뒤 mock 27/27 ×2
**worker**: orchestrator(trace 분석·테스트 보강), codex-main(화면 보호 1줄 + 단위 테스트)

## [2026-10-02] [critic-after-commit]
codex-critic은 커밋 뒤에 부른다. 리뷰 brief가 `git diff main...HEAD`를 가리켜도 미커밋 상태면 diff가 비어 보이고, 워커가 작업 트리를 대신 읽어 주더라도 결과에 범위 경고가 섞인다. 순서: 검증 통과 → 작게 커밋 → 리뷰 → 수정 커밋.
**근거**: s4-system-assistant 1차 리뷰("main과 HEAD가 같은 커밋 … 미커밋 구현을 대상으로")
**worker**: orchestrator

## [2026-10-08] [rereview-fix-commits]
리뷰 지적을 고친 커밋은 같은 리뷰어(문맥 유지)에게 "수정 커밋만" 다시 보게 한다. 정본(데이터 의미)을 바꾸는 수정은 그 값을 만드는 다른 경로(이관 도구·시드·배치)를 깨뜨리기 쉽고, 단위·E2E는 그 경로를 안 탄다. 재검토 프롬프트에 "이 수정으로 같은 값을 쓰는 다른 생산자가 어긋나는지"를 명시한다.
**근거**: s6-u9-sr-flow — 첨부 정본 수정 재검토에서 이관 도구가 옛 위치에 첨부를 붙여 이관 SR 첨부가 비는 회귀 발견
**worker**: orchestrator

## [2026-10-08] [parallel-worktree-e2e]
병렬 워커(worktree)는 단위·DB 테스트까지만 돌리게 하고 E2E는 오케스트레이터가 한 번에 하나씩 돌린다. 워커 테스트와 E2E가 겹치면 부하 플레이크가 나 실패 판독이 흐려진다 — 실패 spec은 `--workers=1`로 재확인한 뒤 판정.
**근거**: s6-u10-polish — Codex 테스트 실행과 겹친 전체 E2E 25/30, 직렬 재실행 11/11
**worker**: orchestrator
