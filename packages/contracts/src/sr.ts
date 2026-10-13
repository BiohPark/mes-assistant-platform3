import { z } from 'zod'

/** SSE는 식별자만 전송한다. 수신 후 GET으로 현재 권한을 다시 적용한다. */
export const SrUpdatedDataSchema = z.object({ srId: z.string().min(1) }).strict()
export type SrUpdatedData = z.infer<typeof SrUpdatedDataSchema>
