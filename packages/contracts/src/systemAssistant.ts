import { z } from 'zod'
import { ClassificationsInputSchema } from './catalog.js'

const nonempty = z.string().trim().min(1)

export const SystemAssistantToolArgs = {
  start_conversation: z.object({ assistantName: nonempty, title: z.string().optional(), tags: z.array(nonempty).optional(), priority: z.enum(['low', 'normal', 'high', 'urgent']).optional() }).strict(),
  create_assistant: z.object({ id: nonempty.optional(), name: nonempty, classifications: ClassificationsInputSchema, summary: z.string().optional(), ownerName: nonempty.optional(), modelId: nonempty.optional() }).strict(),
  add_tag: z.object({ taskCode: nonempty, tag: nonempty }).strict(),
}
