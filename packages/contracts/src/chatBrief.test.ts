import { expect, it } from 'vitest'
import { ChatBriefSchema } from './chatBrief.js'

it('keeps the AI lines optional and the server-computed line required', () => {
  const stats = { questions: 2, participants: [{ id: 'u', name: '사용자' }], startedAt: '2026-10-15T00:00:00.000Z' }
  expect(ChatBriefSchema.parse({ stats, generating: true, failed: false, stale: false })).toMatchObject({ stats, generating: true })
  expect(ChatBriefSchema.parse({ stats, generating: false, failed: false, stale: true,
    ai: { about: '주제', next: '다음', source: 'ai', model: 'm', basedOnSeq: 3, generatedAt: '2026-10-15T00:00:00.000Z' } }).ai?.next).toBe('다음')
  expect(ChatBriefSchema.safeParse({ generating: false, failed: false, stale: false }).success).toBe(false)
})
