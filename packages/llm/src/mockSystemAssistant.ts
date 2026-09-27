import type { ToolCall } from './provider.js'

interface MockSystemResult {
  text: string
  toolCalls: ToolCall[]
}

function call(name: string, args: Record<string, unknown>): ToolCall {
  return { id: `call_${Math.random().toString(36).slice(2, 8)}`, name, arguments: JSON.stringify(args) }
}

function quoted(text: string): string | undefined {
  const m = /["'“”「](.+?)["'“”」]/.exec(text)
  return m?.[1]
}

function kebab(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-|-$/g, '')
}

const HELP =
  "예: 'FDS 작성 도우미로 \"알람 필터 FDS\" 대화 시작해줘 SR-2026-0002', 'WK-2026-0006 에 SR-2026-0001 태그 붙여줘', 'WK-2026-0007 에 #release-2026-10 태그'"

/** 규칙 기반 시스템 assistant. 실제 LLM 없이도 3종 도구(대화 시작·에이전트 등록·태그) 시연이 가능하다. */
export function mockSystemAssistant(userText: string): MockSystemResult {
  const t = userText.trim()
  const task = /WK-\d{4}-\d{4}/.exec(t)?.[0]
  const sr = /SR-\d{4}-\d{4}/.exec(t)?.[0]
  const hashTag = /#([^\s,，]+)/.exec(t)?.[1]

  if (task && (sr || hashTag)) {
    const tag = sr ?? hashTag!
    return { text: `${task} 대화에 ${tag} 태그를 붙이겠습니다.`, toolCalls: [call('add_tag', { taskCode: task, tag })] }
  }
  if (/(어시스턴트|에이전트)\s*(등록|추가|생성)/.test(t)) {
    const id = /ID\s*[:：]?\s*([a-z0-9-]+)/i.exec(t)?.[1]
    const name = /이름\s*[:：]?\s*([^,，]+)/.exec(t)?.[1]?.trim() ?? quoted(t) ?? '새 에이전트'
    const lv = /([^,，\s]+)\s*[›>]\s*([^,，\s]+)/.exec(t)
    return {
      text: `"${name}" 에이전트를 등록하겠습니다. 모델 ID는 관리 페이지에서 매핑하세요.`,
      toolCalls: [call('create_assistant', { id: id ?? kebab(name), name, level1: lv?.[1] ?? '공통', level2: lv?.[2] ?? '기타', summary: '' })],
    }
  }
  const m = /(.+?)\s*(?:어시스턴트|에이전트|도우미)?\s*(?:로|으로|에|에서|와|과)\s*["'“”「](.+?)["'“”」]\s*(?:업무|대화)/.exec(t)
  if (m && /(만들|생성|추가|시작)/.test(t)) {
    const priority = /긴급/.test(t) ? 'urgent' : /높/.test(t) ? 'high' : 'normal'
    return {
      text: `${m[1].trim()}와 "${m[2]}" 대화를 시작하겠습니다${sr ? ` (${sr} 태그)` : ''}.`,
      toolCalls: [call('start_conversation', { assistantName: m[1].trim(), title: m[2], tags: sr ? [sr] : [], priority })],
    }
  }
  return { text: `"${t.slice(0, 60)}" 요청을 이해하지 못했습니다. ${HELP}`, toolCalls: [] }
}
