export * from './auth.js'
export * from './catalog.js'
export * from './chatBrief.js'
export * from './health.js'
export * from './llm.js'
export * from './systemAssistant.js'

export const FILE_MAX_PER_REQUEST = 20
export * from './sr.js'
export * from './tasks.js'
export * from './previousMaterials.js'

/** Number of distinct materials available in the unified attachment picker. */
export interface MaterialCandidateCount { count: number }

/** Task response metadata used before the full message list arrives. */
export interface TaskMessageState { hasMessages: boolean }
