/**
 * Mock 모드 전용 **대역(stand-in)** 응답.
 * 실제 질문 흐름·작성 절차는 각 assistant(OpenWebUI) 안에서 따로 구현되며, 이 플랫폼은 흉내만 낸다.
 * Live 모드에서는 이 파일이 쓰이지 않는다. 시연용이므로 실제 assistant 동작과 달라도 된다.
 */
export interface MockContext {
  taskTitle: string
  assistantName: string
  inputFileNames: string[]
  /** 파일·참조 대화 등 고른 입력이 하나라도 있는지 (없으면 inputFileNames로 판단) */
  hasInputs?: boolean
  userText: string
  turn: number
}

type ScenarioFn = (ctx: MockContext) => string

/** 입력이 있으면 답변 앞의 "사용한 자료" 블록(mockProvider)이 보여 주므로 여기서는 없을 때만 안내한다 */
const inputsLine = (ctx: MockContext) =>
  (ctx.hasInputs ?? ctx.inputFileNames.length > 0)
    ? '선택한 자료를 참고했습니다.'
    : '선택된 입력이 없어 대화 내용만으로 진행합니다. 자료 패널에서 파일이나 같은 태그의 대화를 체크(참고) 또는 ★(주 입력)로 고르면 반영됩니다.'

const URS: ScenarioFn[] = [
  (ctx) => `${inputsLine(ctx)}

"${ctx.taskTitle}" 요구사항 정리를 시작하겠습니다. URS 작성 전에 확인이 필요한 항목입니다.

1. **트리거/대상 범위** — 어떤 장비(클래스)와 어떤 이벤트가 대상인가요?
2. **GxP 영향** — 배치 기록(EBR)이나 장비 상태에 영향이 있나요?
3. **예외 처리** — 자동 처리가 실패했을 때 운전자가 개입하는 절차가 있나요?

답변해 주시면 요구사항 ID를 부여해 초안을 작성하겠습니다.`,
  (ctx) => `답변 감사합니다. 반영해서 URS 초안을 작성했습니다.

# URS — ${ctx.taskTitle}

## 1. 배경
${ctx.userText.slice(0, 160)}

## 2. 요구사항
| ID | 요구사항 | 우선순위 | GxP |
|---|---|---|---|
| URS-01 | 대상 이벤트 발생 시 시스템이 자동으로 처리를 수행한다 | High | Yes |
| URS-02 | 처리 결과는 Equipment Log에 actor=SYSTEM 으로 기록한다 | High | Yes |
| URS-03 | 실패 시 운전자에게 알람을 표시하고 수동 처리 경로를 제공한다 | Medium | Yes |
| URS-04 | 수동 처리 시 사유 입력을 필수로 한다 | Medium | Yes |

## 3. 제외 범위
- 타 시스템 인터페이스 변경 (별도 CR)

답변 아래 **산출물로 저장**을 누르면 같은 태그를 가진 대화(예: FDS)의 공유 자료함에 나타납니다.`,
  (ctx) => `요청하신 내용을 반영해 URS를 갱신했습니다. 변경 사항:

- ${ctx.userText.slice(0, 80)} → 요구사항 반영 (URS-05 신규)
- 우선순위 재정렬

체크리스트의 "요구사항 ID 부여 및 우선순위 정리" 항목을 완료 처리하셔도 됩니다. 비즈니스 오너 리뷰가 끝나면 단계를 완료해 주세요.`,
]

const FDS: ScenarioFn[] = [
  (ctx) => `${inputsLine(ctx)}

URS 항목을 기능 명세로 매핑했습니다.

# FDS 초안 — ${ctx.taskTitle}

## 기능 목록
| FDS ID | URS | 기능 설명 | 구성요소 |
|---|---|---|---|
| FDS-01 | URS-01 | 이벤트 구독 및 상태 전환 서비스 호출 | EquipmentStatusService |
| FDS-02 | URS-02 | 전환 이력 기록 (actor=SYSTEM, source 컬럼) | EQUIPMENT_STATUS_LOG |
| FDS-03 | URS-03 | 실패 알람 발생 및 수동 처리 화면 진입 | AlarmService, ET UI |

## 데이터 모델 변경
- \`EQUIPMENT_STATUS_LOG.TRANSITION_SOURCE VARCHAR2(20)\` 추가

## 추적성
URS-01~04 → FDS-01~03 (URS-04는 기존 기능 재사용)

인터페이스(EBR/LIMS) 영향 검토가 필요하면 말씀해 주세요.`,
  (ctx) => `"${ctx.userText.slice(0, 60)}" 관련 검토 결과입니다.

- 기존 인터페이스 스펙 변경 없음 (상태값 집합 유지)
- 리포트 뷰가 \`SELECT *\`를 사용하는 경우 컬럼 추가 영향 가능 → 뷰 정의 확인 권장
- 성능: 이벤트 구독은 기존 큐를 재사용하므로 추가 부하 미미

FDS 문서에 "인터페이스 영향 검토" 절을 추가했습니다. 산출물로 저장하시겠어요?`,
  () => `FDS 리뷰 회의용 요약을 준비했습니다.

1. 기능 3건, 데이터 모델 변경 1건
2. 인터페이스 영향 없음 (뷰 확인 필요 1건)
3. 미결 사항: 알람 코드 체계 확정

체크리스트 항목을 확인하고 단계를 완료하면 테스트 단계의 입력으로 전달됩니다.`,
]

const TEST: ScenarioFn[] = [
  (ctx) => `${inputsLine(ctx)}

FDS 항목별 테스트 케이스를 생성했습니다.

# 테스트 케이스 — ${ctx.taskTitle}

| TC | FDS | 사전조건 | 절차 | 예상결과 |
|---|---|---|---|---|
| TC-01 | FDS-01 | 대상 장비 상태 초기값 | 트리거 이벤트 발생 | 상태 자동 전환 |
| TC-02 | FDS-02 | TC-01 수행 | Equipment Log 조회 | actor=SYSTEM 기록 |
| TC-03 | FDS-03 | 서비스 강제 실패 | 트리거 이벤트 발생 | 알람 표시, 수동 처리 가능 |
| TC-04 | FDS-01 | 경계값 조건 | 임계값 ±1 단위로 수행 | 경계 조건 정확히 동작 |

테스트 결과를 알려주시면 결과서 형식으로 정리해 드립니다.`,
  (ctx) => `테스트 결과를 반영했습니다.

${ctx.userText.slice(0, 120)}

# 테스트 결과서
- 수행 케이스: 4건 / 통과: 4건 / 결함: 0건
- 수행자: (사용자 전환 드롭다운의 현재 사용자)
- 증빙: 스크린샷 첨부 필요 (파일함에 업로드 후 산출물 태깅)

프로토콜 검증 단계로 넘길 준비가 되었습니다.`,
]

const PROTOCOL: ScenarioFn[] = [
  (ctx) => `${inputsLine(ctx)}

GMP 테스트 프로토콜 요건 점검 결과입니다.

| 항목 | 상태 | 비고 |
|---|---|---|
| 프로토콜 번호/버전 | ✅ | |
| 테스트 케이스 ↔ FDS 추적성 | ✅ | 100% |
| 수행자/검토자 서명란 | ⚠️ | 검토자 서명 누락 |
| 증빙(스크린샷/로그) | ⚠️ | TC-03 증빙 없음 |
| 결함 조치 기록 | ✅ | 해당 없음 |

⚠️ 2건을 보완하면 승인 요청서를 생성할 수 있습니다.`,
  () => `보완 내용을 확인했습니다. 승인 요청서 초안입니다.

# 승인 요청서
- 대상: 테스트 프로토콜 v1.1
- 검토 의견: 형식 요건 충족, 증빙 완비
- 승인 요청 대상: QA

산출물로 저장 후 배포 단계로 진행하세요.`,
]

const DEPLOY: ScenarioFn[] = [
  (ctx) => `${inputsLine(ctx)}

배포 대상 기준 검증 항목과 조회 SQL을 준비했습니다. 배포 자체는 수동으로 진행하고, 완료 후 아래 결과를 알려주세요.

\`\`\`sql
-- 1. 변경 오브젝트 반영 확인
SELECT OBJECT_NAME, STATUS, LAST_DDL_TIME
FROM USER_OBJECTS
WHERE OBJECT_NAME IN ('EQUIPMENT_STATUS_SVC', 'V_EQUIP_STATUS_HIST');

-- 2. 컬럼 추가 확인
SELECT COLUMN_NAME, DATA_TYPE FROM USER_TAB_COLUMNS
WHERE TABLE_NAME = 'EQUIPMENT_STATUS_LOG' AND COLUMN_NAME = 'TRANSITION_SOURCE';
\`\`\`

체크 항목: 오브젝트 VALID 2건, 컬럼 1건, 설정값 1건`,
  (ctx) => `조회 결과를 대조했습니다.

${ctx.userText.slice(0, 120)}

# 배포 검증 결과서
| 항목 | 기대 | 실제 | 판정 |
|---|---|---|---|
| 오브젝트 상태 | VALID ×2 | VALID ×2 | ✅ |
| TRANSITION_SOURCE 컬럼 | 존재 | 존재 | ✅ |
| 설정값 | 72 | 72 | ✅ |

모든 항목 일치. 산출물로 저장 후 업무를 완료하면 완료 리포트가 생성됩니다.`,
]

const GENERIC: ScenarioFn[] = [
  (ctx) => `${inputsLine(ctx)}

"${ctx.assistantName}" 단계 작업을 돕겠습니다. 요청하신 내용: "${ctx.userText.slice(0, 80)}"

정리한 내용을 산출물로 저장하거나, 추가로 필요한 정보를 알려주세요.`,
]

const DEVIATION: ScenarioFn[] = [
  (ctx) => `${inputsLine(ctx)}

"${ctx.userText.slice(0, 60)}" 건으로 Deviation 초안을 잡겠습니다.

# Deviation 초안
- **발생 개요**: ${ctx.userText.slice(0, 80)}
- **즉시 조치**: (확인 필요) 해당 로트 격리 여부
- **영향 평가**: 제품 품질 / 데이터 무결성 / 다른 로트 영향
- **근본 원인(추정)**: 조사 중

즉시 조치 내용과 발생 일시를 알려주시면 영향 평가를 채우겠습니다.`,
  (ctx) => `반영했습니다.

- 즉시 조치: ${ctx.userText.slice(0, 80)}
- **CAPA 제안**: 수기 입력 단계 제거(시스템 자동 전달) + 확인 서명 단계 추가

CAPA가 시스템 변경으로 이어지면 이 대화에 CC 태그를 붙여 Change Control 대화와 자료를 공유하세요.`,
]

const CHANGE_CONTROL: ScenarioFn[] = [
  (ctx) => `${inputsLine(ctx)}

# Change Control 초안 — ${ctx.taskTitle}
- **변경 사유**: ${ctx.userText.slice(0, 80)}
- **영향 시스템**: MES (확인 필요: EBR, 인터페이스)
- **GxP 영향**: 판단 필요 → 밸리데이션 범위 결정
- **실행 항목**: CC Item 분해 도우미로 분해 예정

변경 범위와 관련 일탈/SR 번호가 있으면 알려주세요. 태그로 붙이면 관련 자료가 자료함에 보입니다.`,
]

const CC_ITEM: ScenarioFn[] = [
  (ctx) => `${inputsLine(ctx)}

CC를 부서별 실행 Item으로 나눴습니다.

| # | 항목 | 담당 | 산출물 |
|---|---|---|---|
| 1 | 시스템 변경 (MES) | MES | FDS 갱신 |
| 2 | 테스트/검증 | QA | 테스트 결과서 |
| 3 | SOP 개정·교육 | 현업 | 교육 기록 |

각 Item을 릴리스 CCA로 넘길 때는 같은 CC 태그를 유지하세요.`,
]

const CCA: ScenarioFn[] = [
  (ctx) => `${inputsLine(ctx)}

# Release CCA — ${ctx.taskTitle}
- **배포 대상**: ${ctx.userText.slice(0, 80)}
- **배포 창**: (확인 필요)
- **선행 조건**: 테스트 결과 승인, SOP 개정 완료
- **롤백 계획**: 이전 버전 재배포 + 설정값 원복

배포 일정과 대상 환경(VAL/PRD)을 알려주세요.`,
]

/** 에이전트별 "시작" 질문 (OpenWebUI 샘플처럼 필요한 정보를 먼저 묻는다) */
const START_QUESTIONS: Array<[RegExp, string[]]> = [
  [/deviation/i, ['발생 일시와 공정/라인', '현상(무엇이 기준과 달랐는지)', '즉시 조치 여부']],
  [/cc-item|cc\) item/i, ['대상 CC 번호', '관련 부서', '완료 기한']],
  [/release-cca|cca/i, ['배포 대상 변경(CC/Item)', '대상 환경(VAL/PRD)', '배포 희망 일정']],
  [/change-control|change control/i, ['변경 제목과 사유', '관련 일탈/SR 번호', '영향 시스템']],
  [/urs|분석/i, ['요청 배경(현업 요구)', '대상 화면/장비/공정', 'GxP 영향 여부']],
  [/deploy-verifier|db-compare|db 비교/i, ['비교할 배포 차수', 'FDS 문서(자료함에서 주 입력으로 선택)', '대상 DB 환경']],
  [/fds|설계/i, ['기준 URS(자료함에서 주 입력으로 선택)', '변경 범위(신규/수정)', '인터페이스 영향']],
  [/test|테스트/i, ['기준 FDS 버전', '테스트 유형(유닛/통합/회귀)', '대상 환경']],
  [/protocol|밸리데이션/i, ['프로토콜 문서', '검증 기준(ISTQB/사내 SOP)', '리뷰 범위']],
]

/** "시작"·인사처럼 내용 없는 첫 메시지 */
export function isStartMessage(text: string): boolean {
  return /^(시작|start|안녕(하세요)?)[\s.!?~]*$/i.test(text.trim())
}

export function startReply(assistantId: string, level2: string, assistantName: string): string {
  const qs = START_QUESTIONS.find(([re]) => re.test(assistantId) || re.test(level2))?.[1] ?? ['작업 목적', '참고할 자료', '원하는 결과물 형태']
  return `안녕하세요, **${assistantName}**입니다. 시작하려면 아래 정보를 알려주세요.

${qs.map((q, i) => `${i + 1}. ${q}`).join('\n')}

같은 SR·CC 번호를 태그로 붙이면 앞 단계 산출물이 자료함에 보이고, 필요한 것만 골라 입력으로 쓸 수 있습니다.`
}

const BY_KEYWORD: Array<[RegExp, ScenarioFn[]]> = [
  [/deviation/i, DEVIATION],
  [/cc-item|cc\) item/i, CC_ITEM],
  [/cca/i, CCA],
  [/change-control|change control/i, CHANGE_CONTROL],
  [/deploy-verifier|db-compare/i, DEPLOY],
  [/urs|요구/i, URS],
  [/fds|기능/i, FDS],
  [/test|테스트/i, TEST],
  [/protocol|프로토콜|검증/i, PROTOCOL],
  [/deploy|배포/i, DEPLOY],
]

/** 어시스턴트 ID 또는 업무 Lv2 키워드로 시나리오를 고른다 */
export function scenarioFor(assistantId: string, level2: string): ScenarioFn[] {
  const hit = BY_KEYWORD.find(([re]) => re.test(assistantId) || re.test(level2))
  return hit ? hit[1] : GENERIC
}

export function mockReply(assistantId: string, level2: string, ctx: MockContext): string {
  const list = scenarioFor(assistantId, level2)
  return list[Math.min(ctx.turn, list.length - 1)](ctx)
}

/** SR 접수 에이전트 시나리오 (턴 순서대로) */
export const SR_INTAKE: ScenarioFn[] = [
  (ctx) => `안녕하세요, ${ctx.assistantName}입니다(SR 접수). "${ctx.userText.slice(0, 60)}" 요청 잘 들었습니다.

먼저 **배경**을 알려주세요. 현재 어떤 화면/절차에서 불편하거나 문제가 생기나요?`,
  () => `감사합니다. 다음으로 **원하는 결과**를 한 문장으로 말씀해 주세요. (예: "알람 목록에서 장비별로 필터링할 수 있으면 좋겠다")`,
  () => `좋습니다. 마지막으로 **희망 기한**이 있나요? 없으면 "없음"이라고 답해 주세요.`,
  (ctx) => `정리했습니다.

- **제목**: ${ctx.taskTitle}
- **배경**: (대화 내용 참고)
- **원하는 결과**: ${ctx.userText.slice(0, 80)}
- **희망 기한**: 확인됨

상단의 **접수로 전환** 버튼을 누르면 위 내용으로 초안이 채워지고 제목은 AI가 따로 제안합니다. 수정 후 제출해 주세요.`,
]

