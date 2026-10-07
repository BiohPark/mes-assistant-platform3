import { z } from 'zod'

/** GET /api/health 응답 */
export const HealthSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  db: z.enum(['up', 'down']),
  version: z.string(),
  commit: z.string(),
})
export type Health = z.infer<typeof HealthSchema>
