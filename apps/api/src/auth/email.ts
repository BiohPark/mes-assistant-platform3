/** 기본 이메일은 응답에서만 계산한다. 저장값은 그대로 보존한다. */
export function emailView(user: { email?: string | null; loginId?: string | null }, domain?: string) {
  if (user.email != null) return { email: user.email, emailIsDefault: false }
  if (user.loginId && domain) return { email: `${user.loginId}@${domain}`, emailIsDefault: true }
  return { email: null, emailIsDefault: false }
}
