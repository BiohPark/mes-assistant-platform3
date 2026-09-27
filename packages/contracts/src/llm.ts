import { z } from 'zod'

export const LlmModelsSchema = z.object({ models: z.array(z.string()) })
export const LlmStatusSchema = z.object({
  mode: z.enum(['mock', 'live']),
  preset: z.enum(['openwebui', 'openai-compatible']),
  baseUrlHost: z.string(),
  ok: z.boolean(),
  detail: z.string(),
})
