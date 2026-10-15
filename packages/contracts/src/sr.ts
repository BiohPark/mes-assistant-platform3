import { z } from 'zod'

/** SSE는 식별자만 전송한다. 수신 후 GET으로 현재 권한을 다시 적용한다. */
export const SrUpdatedDataSchema = z.object({ srId: z.string().min(1) }).strict()
export type SrUpdatedData = z.infer<typeof SrUpdatedDataSchema>

/** GET /tasks/:id/sr-inputs — 연결 메타와 다음 요청 선택·과거 사용 여부. */
export const TaskSrInputSchema = z.object({
  srId: z.string().min(1), code: z.string(), title: z.string(), body: z.string(),
  bytes: z.number().int().nonnegative(), selected: z.boolean(), used: z.boolean(),
}).strict()
export type TaskSrInput = z.infer<typeof TaskSrInputSchema>
