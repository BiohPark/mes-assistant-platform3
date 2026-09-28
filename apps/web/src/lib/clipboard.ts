/**
 * 클립보드 복사. HTTP(LAN) 등 비보안 컨텍스트에서는 navigator.clipboard가 없으므로
 * 숨긴 textarea + execCommand로 폴백한다. 둘 다 실패하면 false를 돌려 호출자가 값을 직접 보여주게 한다.
 */
export async function copyText(text: string, doc: Document = document): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 권한 거부 등 → 폴백 시도
  }
  try {
    const ta = doc.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    doc.body.appendChild(ta)
    ta.select()
    const ok = doc.execCommand('copy')
    doc.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
