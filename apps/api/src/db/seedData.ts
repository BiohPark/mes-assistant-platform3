import type { Assistant } from '@mes/contracts'
type AssistantStatus = Assistant['status']
type ChecklistTemplateItem = Assistant['checklistTemplate'][number]
const colors = ['#2563eb', '#7c3aed', '#059669', '#d97706', '#dc2626', '#0891b2']
function pickColor(seed: string): string {
  let hash = 0
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return colors[hash % colors.length]!
}

// 데모용 가상 카탈로그. 실제 회사에서는 관리 페이지(또는 이 파일)에서 에이전트 이름·설명·모델 ID·링크1을
// 사내 OpenWebUI 설정에 맞게 바꿔 쓴다. 모델 ID는 모두 비워 두어 설정의 공통 기본 모델을 쓴다.
// 링크1도 비워 두면 설정의 OpenWebUI 주소 + `?model={모델 ID}` 로 만들어진다.
// 질문 흐름·역할 같은 워크플로우는 각 assistant(OpenWebUI) 안에 있고, 여기에는 안내 문구만 둔다.
// 체크리스트는 기본값일 뿐이며 관리 페이지에서 에이전트별로 수정한다(새 대화에만 복사, 강제 아님).
// 체크리스트는 기본값일 뿐이며 관리 페이지에서 에이전트별로 수정한다(새 대화에만 복사, 강제 아님).

const T = '2026-09-01T00:00:00.000Z'

function ct(prefix: string, items: Array<[label: string, required: boolean]>): ChecklistTemplateItem[] {
  return items.map(([label, required], i) => ({ id: `ct_${prefix}_${i + 1}`, label, required }))
}

interface Spec {
  id: string
  name: string
  level1: string
  level2: string
  summary: string
  ownerId: string
  status: AssistantStatus
  usage?: string[]
  inputs?: string[]
  outputs?: string[]
  checklist?: Array<[string, boolean]>
}

const START = '"시작"을 보내면 필요한 정보를 하나씩 질문합니다.'

const SPECS: Spec[] = [
  {
    id: 'deviation-drafter',
    name: 'Deviation 초안 도우미',
    level1: 'Record',
    level2: 'Deviation',
    summary: '일탈 보고서 섹션별 초안 작성과 작성본 검토를 돕습니다.',
    ownerId: 'seed-system',
    status: 'open',
    checklist: [['발생 개요·일시 기재', true], ['즉시 조치 기재', true], ['영향 평가 작성', false], ['근본 원인·CAPA 초안', false]],
    usage: [START, '작성 또는 검토 중 하나를 고릅니다.', '작성: 섹션을 고르면 들어가야 할 내용과 예시를 보여 주고 필요한 정보를 묻습니다.', '검토: 작성한 내용을 붙여 넣으면 누락·모호한 표현을 짚어 줍니다.'],
    outputs: ['Deviation 섹션별 초안'],
  },
  {
    id: 'cc-writer',
    name: 'Change Control 작성 도우미',
    level1: 'Record',
    level2: 'Change Control(CC)',
    summary: 'CC Item 목록을 바탕으로 변경 관리 문서의 주요 섹션을 작성합니다.',
    ownerId: 'seed-system',
    status: 'open',
    checklist: [['CC Item 목록을 입력으로 선택', true], ['변경 사유·범위 기재', true], ['위험 평가 작성', false], ['실행 계획 작성', false]],
    usage: [START, 'CC Item 분해 도우미의 산출물을 입력으로 선택하면 섹션 작성에 반영됩니다.', '질문에 답하면 배경·변경 내용·위험 평가·실행 계획 순으로 초안을 만듭니다.'],
    inputs: ['CC Item 목록', '대상 설비/시스템 식별자', '관련 위험 평가 목록'],
    outputs: ['CC 문서 초안 (배경 · 변경 내용 · 위험 평가 · 실행 계획)'],
  },
  {
    id: 'cc-item-builder',
    name: 'CC Item 분해 도우미',
    level1: 'Record',
    level2: 'Change Control(CC) Item',
    summary: '변경 요청을 부서·시스템별 실행 Item 표로 나눕니다.',
    ownerId: 'seed-system',
    status: 'open',
    checklist: [['부서·시스템별 Item 분해', true], ['Item별 담당 지정', false], ['Item 표 산출물 저장', true]],
    usage: [START, '질문에 답하면 Item 표가 만들어집니다.', '표를 산출물로 저장해 CC 작성 대화의 입력으로 쓰세요.'],
    outputs: ['CC Item 표'],
  },
  {
    id: 'release-cca-writer',
    name: 'Release CCA 작성 도우미',
    level1: 'Record',
    level2: 'Change Control Action(CCA) Item',
    summary: '운영 환경 배포용 Release CCA 문안을 만듭니다.',
    ownerId: 'seed-system',
    status: 'open',
    checklist: [['배포 대상·환경 확인', true], ['롤백 계획 기재', true], ['QA 검토 요청', false]],
    usage: [START, '배포 대상·환경·일정·롤백 계획 등을 차례로 묻습니다.', '부족한 정보는 추가로 질문합니다.', '결과를 확인한 뒤 QA 검토를 요청하세요.'],
    outputs: ['Release CCA 문안'],
  },
  {
    id: 'urs-analyst-basic',
    name: 'URS 분석 도우미 (기본)',
    level1: 'SDLC',
    level2: '분석',
    summary: '요청 사항을 기본 URS 표 형식으로 정리합니다.',
    ownerId: 'seed-system',
    status: 'developing',
    checklist: [['대상 식별자 확인', true], ['URS 표 작성', true], ['요청자 확인', false]],
    inputs: ['대상 설비/화면 식별자', '추가·변경하려는 항목'],
    outputs: ['URS 표 (ID · 대상 · 요구사항 · 우선순위)'],
  },
  {
    id: 'urs-analyst',
    name: 'URS 분석 도우미',
    level1: 'SDLC',
    level2: '분석',
    summary: '현업 요청을 대화로 구체화해 URS 항목과 변경 범위를 도출합니다. SR 접수에도 쓰입니다.',
    ownerId: 'seed-system',
    status: 'testing',
    checklist: [['변경 범위 확정', true], ['URS 표 작성', true], ['GxP 영향 표시', false], ['요청자 확인', false]],
    inputs: ['대상 설비/화면 식별자', '추가·변경하려는 항목'],
    outputs: ['URS 표 (ID · 대상 · 요구사항 · 우선순위 · GxP)'],
  },
  {
    id: 'fds-writer',
    name: 'FDS 작성 도우미',
    level1: 'SDLC',
    level2: '설계',
    summary: '확정된 URS를 기준으로 수정이 필요한 FDS 섹션과 내용을 정리합니다.',
    ownerId: 'seed-system',
    status: 'developing',
    checklist: [['URS를 주 입력으로 선택', true], ['변경 대상 섹션 도출', true], ['URS 추적성 표 작성', false], ['FDS 산출물 저장', false]],
    inputs: ['URS', '개정 전 FDS'],
    outputs: ['FDS 변경 항목 표'],
  },
  {
    id: 'fds-reviewer',
    name: 'FDS 리뷰 도우미',
    level1: 'SDLC',
    level2: '설계',
    summary: '변경 전후 FDS와 변경 요청을 비교해 누락·과잉 반영을 점검합니다.',
    ownerId: 'seed-system',
    status: 'developing',
    checklist: [['개정 전·후 FDS 선택', true], ['누락 반영 점검', true], ['불필요 반영 점검', false]],
    inputs: ['FDS 변경 항목', '개정 전 FDS', '개정 후 FDS'],
    outputs: ['반영 누락·불필요 반영 점검표'],
  },
  {
    id: 'test-scenario-writer',
    name: '테스트 시나리오 도우미',
    level1: 'SDLC',
    level2: '테스트',
    summary: '설계 변경 내용을 바탕으로 단위·통합·회귀 테스트 시나리오를 제안합니다.',
    ownerId: 'seed-system',
    status: 'developing',
    checklist: [['기준 FDS 선택', true], ['단위·통합 시나리오', true], ['회귀 시나리오', false], ['사전 조건 기재', false]],
    inputs: ['개정 전 FDS', '개정 후 FDS'],
    outputs: ['테스트 시나리오 (No · FDS 섹션 · 목표 · 방법 · 사전 조건)'],
  },
  {
    id: 'deploy-verifier',
    name: '배포 검증 도우미',
    level1: 'SDLC',
    level2: '배포',
    summary: '배포 후 설계 문서와 실제 DB/설정을 비교해 반영 상태를 확인합니다.',
    ownerId: 'seed-system',
    status: 'developing',
    checklist: [['배포 대상 목록 확인', true], ['FDS 대비 DB·설정 비교', true], ['확인표 산출물 저장', false]],
    inputs: ['배포 대상 목록', 'FDS'],
    outputs: ['반영 누락·불필요 반영 확인표'],
  },
  {
    id: 'cca-writer',
    name: 'CCA 문구 도우미',
    level1: 'SDLC',
    level2: '배포',
    summary: '배포 Item별 CCA에 들어갈 문장을 만듭니다.',
    ownerId: 'seed-system',
    status: 'testing',
    checklist: [['배포 Item 확인', true], ['CCA 문장 검토', false]],
    usage: [START, '생성된 문장을 검토한 뒤 CCA 문서에 옮겨 쓰세요.'],
    outputs: ['CCA 문장'],
  },
  {
    id: 'protocol-reviewer',
    name: '프로토콜 리뷰 도우미',
    level1: 'SDLC',
    level2: '밸리데이션',
    summary: '밸리데이션 프로토콜과 설계 문서를 비교해 적합성을 점검합니다.',
    ownerId: 'seed-system',
    status: 'developing',
    checklist: [['프로토콜·설계 문서 선택', true], ['적합성 점검', true], ['수정 필요 항목 정리', false]],
    inputs: ['개정 전 FDS', '개정 후 FDS', '밸리데이션 프로토콜'],
    outputs: ['프로토콜 수정 필요 항목'],
  },
]

/** SR 접수 기본 에이전트 */
export const SR_INTAKE_ASSISTANT_ID = 'urs-analyst'

export const SEED_ASSISTANTS: Assistant[] = SPECS.map((s, i) => ({
  id: s.id,
  name: s.name,
  level1: s.level1,
  level2: s.level2,
  summary: s.summary,
  order: i + 1,
  expectedInputs: s.inputs ?? [],
  expectedOutputs: s.outputs ?? [],
  ownerId: s.ownerId,
  status: s.status,
  usageExample: s.usage?.length ? `### 사용법\n${s.usage.map((u) => `- ${u}`).join('\n')}` : '',
  checklistTemplate: ct(s.id, s.checklist ?? []),
  color: pickColor(s.id),
  createdBy: 'seed-system',
  createdAt: T,
  updatedAt: T,
  level1CodeId: `assistant_level1:${s.level1}`,
  level2CodeId: `assistant_level2:${s.level2}`,
  revision: 0,
}))
