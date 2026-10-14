import { z } from 'zod'

/**
 * GET /api/tasks/:id/brief — 대화 요약 카드(표시 전용).
 * ai: AI가 만든 1줄(무슨 대화)·3줄(다음 할 일 제안). stats: 서버가 계산하는 2줄(질문 횟수·참여자·시작 시각).
 * 요청 조립·트레이·참조 요약에는 쓰지 않는다.
 */
export const ChatBriefSchema = z.object({
  ai: z.object({
    about: z.string(), next: z.string(), source: z.enum(['ai', 'rule']), model: z.string().optional(),
    /** 이 결과를 만들 때 본 마지막 메시지 순번 */
    basedOnSeq: z.number().int(), generatedAt: z.string(),
  }).optional(),
  stats: z.object({
    /** AI에게 보낸 질문(팀 의견 제외) 수 */
    questions: z.number().int(),
    participants: z.array(z.object({ id: z.string(), name: z.string() })),
    startedAt: z.string(),
  }),
  /** 백그라운드 생성이 대기·진행 중 */
  generating: z.boolean(),
  /** 마지막 생성 시도가 실패했다(다음 진입 때 다시 시도) */
  failed: z.boolean(),
  /** 저장된 결과 뒤로 새 메시지가 있다 */
  stale: z.boolean(),
})
export type ChatBrief = z.infer<typeof ChatBriefSchema>
