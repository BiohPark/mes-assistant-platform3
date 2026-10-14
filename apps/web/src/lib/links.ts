/** OpenWebUI API baseUrl에서 웹 UI 루트를 만든다 (`/api` 접미사 제거). */
export function openWebUiBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '').replace(/\/api$/, '')
}

/** 링크1: 어시스턴트(=모델)로 바로 열리는 OpenWebUI 주소 */
export function assistantExternalUrl(baseUrl: string, assistantId: string): string {
  return `${openWebUiBase(baseUrl)}/?model=${encodeURIComponent(assistantId)}`
}

/** 주소에 model= 쿼리가 없으면 ?model=ID(쿼리가 있으면 &model=ID)를 붙인다. #조각은 뒤에 둔다 */
export function withModelParam(url: string, modelId: string): string {
  const hashAt = url.indexOf('#')
  const [base, hash] = hashAt < 0 ? [url, ''] : [url.slice(0, hashAt), url.slice(hashAt)]
  if (/[?&]model=/.test(base)) return url
  return `${base}${base.includes('?') ? '&' : '?'}model=${encodeURIComponent(modelId)}${hash}`
}

/** 링크1: 저장된 link1 → 전역 규칙(OpenWebUI 주소, {modelId} 자리표시자 선택) → 기본 주소 순. 연결 모델이 없으면 숨긴다 */
export function assistantLink1(baseUrl: string, assistant: { id: string; link1?: string; modelId?: string }, rule?: string): string | undefined {
  if (assistant.link1) return assistant.modelId ? withModelParam(assistant.link1, assistant.modelId) : assistant.link1
  if (!assistant.modelId) return undefined
  if (rule) {
    const filled = rule.replaceAll('{assistantId}', encodeURIComponent(assistant.id))
    return rule.includes('{modelId}') ? filled.replaceAll('{modelId}', encodeURIComponent(assistant.modelId)) : withModelParam(filled, assistant.modelId)
  }
  return baseUrl ? assistantExternalUrl(baseUrl, assistant.modelId) : undefined
}
