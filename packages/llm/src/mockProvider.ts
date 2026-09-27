import type { ChatChunk, ChatProvider, ChatRequest, ToolCall } from './provider.js'
import { SR_INTAKE, isStartMessage, mockReply, startReply } from './mockScenarios.js'
import { mockSystemAssistant } from './mockSystemAssistant.js'

const CHUNK_DELAY_MS = 18
const FIRST_TOKEN_DELAY_MS = 350

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new DOMException('aborted', 'AbortError'))
    })
  })
}

/**
 * 시연에서 "선택한 자료가 실제로 쓰였는지" 보이도록 매 답변 앞에 붙이는 블록.
 * 실제 assistant는 이런 블록을 만들지 않는다 — Mock 대역임을 함께 밝힌다.
 */
export function usedInputsBlock(lines: string[] | undefined): string {
  if (!lines?.length) return ''
  return `> **사용한 자료** (Mock 대역 표시 — 이번 요청에 실제로 담긴 자료)\n${lines.map((l) => `> - ${l}`).join('\n')}\n\n`
}

/** 단어/구두점 단위로 잘라 스트리밍 느낌을 낸다 */
function tokenize(text: string): string[] {
  return text.match(/[^\s]+\s*|\s+/g) ?? [text]
}

export const MOCK_MODELS = [
  'glm-5.2',
  'et-urs-assistant',
  'et-fds-assistant',
  'et-review-assistant',
  'et-test-assistant',
  'et-deploy-assistant',
  'eq-master-assistant',
  'qa-deviation-assistant',
  'meeting-notes-assistant',
  'sr-intake-assistant',
]

/** 백엔드 없이 시연 가능한 시나리오 기반 응답기 */
export class MockProvider implements ChatProvider {
  readonly kind = 'mock' as const

  async ping(): Promise<{ ok: boolean; detail: string }> {
    return { ok: true, detail: 'Mock 모드 — 네트워크 호출 없음' }
  }

  async listModels(): Promise<string[]> {
    return [...MOCK_MODELS]
  }

  async *stream(req: ChatRequest): AsyncIterable<ChatChunk> {
    const userText = [...req.messages].reverse().find((m) => m.role === 'user')?.content ?? ''
    const turn = req.messages.filter((m) => m.role === 'assistant').length
    const meta = req.meta ?? {}

    let text: string
    let toolCalls: ToolCall[] = []
    if (meta.systemAssistant) {
      const r = mockSystemAssistant(userText)
      text = r.text
      toolCalls = r.toolCalls
    } else if (meta.srIntake) {
      const ctx = { taskTitle: meta.taskTitle ?? userText.slice(0, 40), assistantName: meta.assistantName ?? 'SR 접수 에이전트', inputFileNames: [], userText, turn }
      text = SR_INTAKE[Math.min(turn, SR_INTAKE.length - 1)](ctx)
    } else if (isStartMessage(userText)) {
      text = startReply(meta.assistantId ?? '', meta.assistantLevel2 ?? '', meta.assistantName ?? '에이전트')
    } else {
      // "시작"으로 연 대화는 그 턴을 빼고 시나리오를 센다
      const firstUser = req.messages.find((m) => m.role === 'user')?.content ?? ''
      const offset = isStartMessage(firstUser) ? 1 : 0
      text = mockReply(meta.assistantId ?? '', meta.assistantLevel2 ?? '', {
        taskTitle: meta.taskTitle ?? '업무',
        assistantName: meta.assistantName ?? '어시스턴트',
        inputFileNames: meta.inputFileNames ?? [],
        hasInputs: !!meta.usedInputs?.length || !!meta.inputFileNames?.length,
        userText,
        turn: Math.max(0, turn - offset),
      })
    }

    if (!meta.systemAssistant) text = usedInputsBlock(meta.usedInputs) + text

    try {
      await sleep(FIRST_TOKEN_DELAY_MS, req.signal)
      for (const tok of tokenize(text)) {
        yield { type: 'delta', text: tok }
        await sleep(CHUNK_DELAY_MS, req.signal)
      }
      for (const call of toolCalls) yield { type: 'tool_call', call }
      yield { type: 'done' }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        yield { type: 'error', message: '요청이 취소되었습니다.' }
        return
      }
      yield { type: 'error', message: e instanceof Error ? e.message : '알 수 없는 오류' }
    }
  }
}
