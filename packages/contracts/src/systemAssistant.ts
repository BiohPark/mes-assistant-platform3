import { z } from 'zod'

const nonempty = z.string().trim().min(1)

export const SystemAssistantToolArgs = {
  start_conversation: z.object({ assistantName: nonempty, title: z.string().optional(), tags: z.array(nonempty).optional(), priority: z.enum(['low', 'normal', 'high', 'urgent']).optional() }).strict(),
  create_assistant: z.object({ id: nonempty, name: nonempty, level1: nonempty, level2: nonempty, summary: z.string().optional(), ownerName: nonempty.optional(), modelId: nonempty.optional() }).strict(),
  add_tag: z.object({ taskCode: nonempty, tag: nonempty }).strict(),
}
