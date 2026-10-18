import { createHash } from 'node:crypto'
import type { BuiltRequest } from '@mes/llm'
import type { AnswerDetail } from '@mes/domain'

/** 조립한 원문·선택 ID/범위·모델·전달 방식·한도까지 묶는다. 추정 시각만 제외한다. */
export function inputSignature(actor: string, threadId: string, detail: AnswerDetail | undefined, built: Pick<BuiltRequest, 'model' | 'messages' | 'info'>): string {
  const { at: _at, ...info } = built.info
  return createHash('sha256').update(JSON.stringify({ actor, threadId, detail: detail ?? 'brief', model: built.model, messages: built.messages, info })).digest('hex')
}
