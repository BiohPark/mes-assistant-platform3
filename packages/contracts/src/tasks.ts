import { z } from 'zod'

export const TASK_PAGE_SIZE = 30
export const TASK_PAGE_MAX = 200
/** responding = pending/streaming; failed = failed/interrupted (existing board filter). none = no displayed request. */
export const taskAiFilterSchema = z.enum(['pending', 'streaming', 'failed', 'interrupted', 'none', 'responding'])
export type TaskAiFilter = z.infer<typeof taskAiFilterSchema>

/** Query values after HTTP normalization. New controls opt into paging (30/200).
 * GET /tasks retains an array body; X-Next-Cursor is absent on the final page.
 * GET /tasks/board returns { columns: [{ assistantId, total, items, nextCursor }] }.
 * Continue a column using its assistantId + cursor; total ignores the cursor.
 */
export const taskListQuerySchema = z.object({
  assistantId: z.string().min(1).optional(),
  status: z.array(z.enum(['todo', 'in_progress', 'on_hold', 'done'])).optional(),
  tags: z.array(z.string()).optional(),
  mine: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(TASK_PAGE_MAX).optional(),
  cursor: z.string().min(1).max(1024).optional(),
  q: z.string().trim().max(500).optional(),
  ai: z.array(taskAiFilterSchema).optional(),
  activeWithinDays: z.coerce.number().int().min(0).max(36500).optional(),
  view: z.literal('summary').optional(),
})
