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

export const ThemeSchema = z.enum(['system', 'light', 'dark'])
export type Theme = z.infer<typeof ThemeSchema>
export const LocaleSchema = z.enum(['ko', 'en'])
export type Locale = z.infer<typeof LocaleSchema>
/** 이메일 형식의 점·영문 TLD 규칙을 유지하며 HTML 이메일 입력과 같은 도메인 구간 경계를 적용한다. */
export const EmailDomainSchema = z.string()
  .max(253, '이메일 도메인은 전체 253자 이하여야 합니다')
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i, '이메일 도메인의 각 구간은 1–63자의 영숫자·하이픈이며 앞뒤 하이픈은 금지됩니다. 최상위 도메인은 영문 2자 이상이어야 합니다')
export const EmailPatchSchema = z.union([
  z.email().max(191).refine((email) => EmailDomainSchema.safeParse(email.slice(email.lastIndexOf('@') + 1)).success, '유효한 이메일 도메인이 필요합니다'),
  z.literal('').transform(() => null),
  z.null(),
])
const EmailViewShape = { email: z.string().nullable(), emailIsDefault: z.boolean() }
export const ProfilePatchSchema = z.object({
  name: UserNameSchema.optional(),
  email: EmailPatchSchema.optional(),
  theme: ThemeSchema.optional(),
  locale: LocaleSchema.optional(),
}).strict().refine((input) => Object.values(input).some((value) => value !== undefined))
export type ProfilePatch = z.infer<typeof ProfilePatchSchema>
export const ProfileSchema = z.object({ name: z.string(), theme: ThemeSchema, locale: LocaleSchema, ...EmailViewShape })

/** GET /api/me 응답 — openapi.yaml `User` */
export const MeSchema = z.object({
  ...EmailViewShape,
  id: z.string(),
  name: z.string(),
  role: z.string(),
  roles: z.array(RoleSchema),
  theme: ThemeSchema,
  locale: LocaleSchema,
  mustChangePassword: z.boolean().optional(),
})
export type Me = z.infer<typeof MeSchema>
