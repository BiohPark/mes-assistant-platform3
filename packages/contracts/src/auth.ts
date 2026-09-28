import { z } from 'zod'

/** 역할 — openapi.yaml `User.roles` (담당자·System Owner·요청자) */
export const RoleSchema = z.enum(['member', 'system_owner', 'requester'])
export type Role = z.infer<typeof RoleSchema>

/** GET /api/me 응답 — openapi.yaml `User` */
export const MeSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  roles: z.array(RoleSchema),
})
export type Me = z.infer<typeof MeSchema>
