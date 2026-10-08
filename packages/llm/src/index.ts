import { MockProvider } from './mockProvider.js'
import { OpenAICompatibleProvider } from './openaiProvider.js'
import type { ChatProvider } from './provider.js'
import type { LlmSettings } from '@mes/domain'

export function createProvider(settings: LlmSettings): ChatProvider {
  return settings.mode === 'live' ? new OpenAICompatibleProvider(settings) : new MockProvider()
}

export type { ChatChunk, ChatProvider, ChatRequest, ChatMessageInput, ToolCall, ChatMeta } from './provider.js'
export * from './checklistReview.js'
export * from './context.js'
export * from './conversationSummary.js'
export * from './mockProvider.js'
export * from './mockScenarios.js'
export * from './mockSystemAssistant.js'
export * from './openaiProvider.js'
export * from './openwebuiFiles.js'
export * from './ports.js'
export * from './promptBuilder.js'
export * from './sse.js'
export * from './srRefine.js'
export * from './title.js'
export * from './tools.js'
