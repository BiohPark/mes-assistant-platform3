/** OpenWebUI API baseUrl에서 웹 UI 루트를 만든다 (`/api` 접미사 제거). */
export function openWebUiBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '').replace(/\/api$/, '')
}

/** 링크1: 어시스턴트(=모델)로 바로 열리는 OpenWebUI 주소 */
export function assistantExternalUrl(baseUrl: string, assistantId: string): string {
  return `${openWebUiBase(baseUrl)}/?model=${encodeURIComponent(assistantId)}`
}

/** 링크1: 저장된 link1이 있으면 그대로, 없으면 모델 ID(없으면 어시스턴트 ID)로 파생 */
export function assistantLink1(baseUrl: string, assistant: { id: string; link1?: string; modelId?: string }): string {
  return assistant.link1 || assistantExternalUrl(baseUrl, assistant.modelId || assistant.id)
}
