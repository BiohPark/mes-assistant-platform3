/** mysql2 오류가 다른 계층에 감싸져도 중복 키만 처리한다. */
export function isDuplicateKey(error: unknown): boolean {
  let current: unknown = error
  while (current && typeof current === 'object') {
    if ('errno' in current && current.errno === 1062) return true
    current = 'cause' in current ? current.cause : undefined
  }
  return false
}
