import type { Assistant, LlmSettings, Task, Thread } from './types.js'

export type ModelSource = 'thread' | 'task' | 'assistant' | 'settings'

export interface ResolvedModel {
  modelId: string
  source: ModelSource
}

/** 모델 결정 순서: 대화 > 업무 > 에이전트 매핑(modelId) > 설정 기본. 빈 문자열은 미지정. 링크에서 모델을 추정하지 않는다. */
export function resolveModel(input: {
  thread?: Pick<Thread, 'modelId'>
  task?: Pick<Task, 'modelId'>
  assistant?: Pick<Assistant, 'modelId'>
  settings?: Pick<LlmSettings, 'model'>
}): ResolvedModel {
  if (input.thread?.modelId) return { modelId: input.thread.modelId, source: 'thread' }
  if (input.task?.modelId) return { modelId: input.task.modelId, source: 'task' }
  if (input.assistant?.modelId) return { modelId: input.assistant.modelId, source: 'assistant' }
  return { modelId: input.settings?.model ?? '', source: 'settings' }
}
