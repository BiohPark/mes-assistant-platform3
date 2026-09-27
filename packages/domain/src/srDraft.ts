export interface SrDraft {
  title: string
  body: string
}

const TITLE_MAX = 60

/** 대화에서 접수 초안을 규칙 기반으로 만든다 (mock/오프라인용). live 모드에서는 AI 요약으로 덮어쓸 수 있다. */
export function draftFromConversation(messages: Array<{ role: 'user' | 'assistant'; content: string }>): SrDraft {
  const userTurns = messages
    .filter((m) => m.role === 'user')
    .map((m) => m.content.trim())
    .filter(Boolean)
  if (userTurns.length === 0) return { title: '', body: '' }
  const [first, ...rest] = userTurns
  const title = first.split('\n')[0].slice(0, TITLE_MAX)
  const body = ['## 요청 내용', `- ${first}`, ...rest.map((t) => `- ${t}`), '', '## 배경 / 원하는 결과 / 희망 기한', '(위 내용을 참고해 정리해 주세요)'].join('\n')
  return { title, body }
}
