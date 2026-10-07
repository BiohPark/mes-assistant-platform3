import type { ToolDefinition } from './provider.js'

/** 시스템 assistant가 플랫폼을 조작할 때 쓰는 도구 정의 (OpenAI function calling 형식) */
export const SYSTEM_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'start_conversation',
      description: '에이전트와 새 대화(업무)를 시작한다. 태그를 주면 같은 태그 대화의 자료를 발견할 수 있다.',
      parameters: {
        type: 'object',
        properties: {
          assistantName: { type: 'string', description: '카탈로그의 에이전트 이름 (부분 일치 허용)' },
          title: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' }, description: 'SR 번호(SR-YYYY-NNNN)나 키워드' },
          priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
        },
        required: ['assistantName'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_assistant',
      description: '새 에이전트를 카탈로그 끝에 등록한다. modelId를 모르면 비워 두면 공통 기본 모델을 쓴다.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '카탈로그 키 (생략하면 서버 생성)' },
          modelId: { type: 'string', description: '사내 AI 모델 ID (모르면 생략)' },
          name: { type: 'string' },
          level1: { type: 'string', description: '업무 Lv1' },
          level2: { type: 'string', description: '업무 Lv2' },
          summary: { type: 'string' },
          ownerName: { type: 'string' },
        },
        required: ['name', 'level1', 'level2'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_tag',
      description: '대화에 태그(SR 번호·키워드)를 붙인다. 같은 태그 대화끼리 자료가 보이게 된다(자동 전달은 아님).',
      parameters: {
        type: 'object',
        properties: {
          taskCode: { type: 'string', description: '예: WK-2026-0006' },
          tag: { type: 'string', description: '예: SR-2026-0001, CC-2026-014' },
        },
        required: ['taskCode', 'tag'],
      },
    },
  },
]

export const SYSTEM_ASSISTANT_PROMPT = `당신은 MES Agent Hub의 시스템 assistant입니다.
사용자가 새 대화 시작, 에이전트 등록, 태그(SR 번호·키워드) 연결을 요청하면 반드시 제공된 도구(function)를 호출하세요.
에이전트는 이름으로 지정하며 카탈로그에서 가장 비슷한 이름을 고릅니다. 대화 코드는 WK-YYYY-NNNN, SR 코드는 SR-YYYY-NNNN 형식입니다.
도구 호출 전에 한두 문장으로 무엇을 할지 요약하세요. 도구 호출 결과는 사용자가 확인 후 적용합니다.
그 외 질문에는 플랫폼 사용법(카드 클릭 → 대화 → 태그로 연결 → 자료함에서 입력 선택 → 칸반에서 진행 확인 → SR 접수)을 간단히 안내하세요.`
