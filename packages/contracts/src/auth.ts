import { z } from 'zod'

export const AuthModeSchema = z.enum(['local', 'oidc'])
export type AuthMode = z.infer<typeof AuthModeSchema>
export const LoginIdSchema = z.string().regex(/^[a-z0-9._-]{3,32}$/)
export const PasswordSchema = z.string().min(8).max(128)
export const CredentialsSchema = z.object({ loginId: LoginIdSchema, password: PasswordSchema })
export const UserNameSchema = z.string().trim().min(1).max(40)
export const SignupSchema = CredentialsSchema.extend({ name: UserNameSchema.optional() })

/** 역할 — openapi.yaml `User.roles` (담당자·System Owner·요청자) */
export const RoleSchema = z.enum(['member', 'system_owner', 'requester'])
export type Role = z.infer<typeof RoleSchema>

/** GET /api/me 응답 — openapi.yaml `User` */
export const MeSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  roles: z.array(RoleSchema),
  mustChangePassword: z.boolean().optional(),
})
export type Me = z.infer<typeof MeSchema>
