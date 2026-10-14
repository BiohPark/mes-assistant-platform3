import type { ChatProvider } from './provider.js'

const MAX_QUESTIONS = 3
const QUESTION_MAX_CHARS = 200

export const FIRST_QUESTIONS_PROMPT =
  '다음 AI 에이전트에게 사용자가 처음 물어볼 만한 질문 3개를 한국어로 만들어라. 한 줄에 질문 하나씩, 질문만 출력하고 번호·따옴표·설명을 붙이지 마라.'

/** 모델 응답을 질문 목록으로 — 번호·글머리표·따옴표만 걷어 내고, 빈 줄·중복·너무 긴 줄은 자르지 않고 버린다 */
export function parseFirstQuestions(text: string): string[] {
  const lines = text.split('\n').map((line) => line.trim().replace(/^(?:[-*•]|\d+[.)])\s*/, '').replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim())
  return [...new Set(lines.filter((line) => line && line.length <= QUESTION_MAX_CHARS))].slice(0, MAX_QUESTIONS)
}

/**
 * 에이전트 추천 첫 질문 — 그 에이전트 모델에 보조 요청 한 번. mock이면 부르지 않고 빈 목록.
 * 실패는 던진다(호출자가 저장하지 않고 나중에 다시 시도한다).
 */
export async function suggestFirstQuestions(provider: ChatProvider, model: string, agent: { name: string; summary: string }, signal?: AbortSignal): Promise<string[]> {
  if (provider.kind === 'mock') return []
  try {
    let acc = ''
    for await (const chunk of provider.stream({
      model,
      messages: [
        { role: 'system', content: FIRST_QUESTIONS_PROMPT },
        { role: 'user', content: `이름: ${agent.name}\n설명: ${agent.summary}` },
      ],
      signal,
    })) {
      if (chunk.type === 'delta') acc += chunk.text
      if (chunk.type === 'error') throw new Error(chunk.message)
    }
    if (signal?.aborted) throw new Error('보조 요청 중지')
    return parseFirstQuestions(acc)
  } catch (error) {
    if (signal?.aborted) throw new Error('보조 요청 중지')
    throw error
  }
}
