import { AssistantSchema, CodeSchema, OwuiAccessCheckSchema, OwuiProbeResultSchema, OwuiResponseProbeResultSchema, ProfileSchema, type Assistant, type ClassificationInput, type ProfilePatch } from '@mes/contracts'

export async function adminRequest(path: string, method: string, body?: unknown) {
  const response = await fetch(`/api/${path}`, { method, credentials: 'same-origin',
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) })
  if (!response.ok) {
    const error: unknown = await response.json().catch(() => null)
    const message = error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' ? error.message : `HTTP ${response.status}`
    throw new Error(message)
  }
  return response.status === 204 ? undefined : response.json() as Promise<unknown>
}
export type AssistantInput = Pick<Assistant, 'name' | 'summary' | 'ownerId' | 'status' | 'usageExample' | 'expectedInputs' | 'expectedOutputs' | 'checklistTemplate'> & {
  classifications?: ClassificationInput[]; id?: string; level1?: string; level2?: string; level1CodeId?: string; level2CodeId?: string; modelId?: string | null; link1?: string | null; docUrl?: string | null
}
export const createAssistant = async (input: AssistantInput) => AssistantSchema.parse(await adminRequest('assistants', 'POST', input))
export const updateAssistant = async (id: string, patch: Partial<Omit<AssistantInput, 'id'>>) => AssistantSchema.parse(await adminRequest(`assistants/${encodeURIComponent(id)}`, 'PATCH', patch))
export const deleteAssistant = (id: string) => adminRequest(`assistants/${encodeURIComponent(id)}`, 'DELETE')
export const saveOrder = (rows: Assistant[]) => adminRequest('assistants/order', 'PUT', { ids: rows.map((row) => row.id), revisions: Object.fromEntries(rows.map((row) => [row.id, row.revision])) })
export async function uploadImage(id: string, file: File | null) {
  if (!file) return adminRequest(`assistants/${encodeURIComponent(id)}/image`, 'DELETE')
  const form = new FormData(); form.append('file', file)
  const response = await fetch(`/api/assistants/${encodeURIComponent(id)}/image`, { method: 'POST', credentials: 'same-origin', body: form })
  if (!response.ok) throw new Error(`이미지 저장 실패 (HTTP ${response.status})`)
  return response.json() as Promise<unknown>
}
/** 유효 모델·출처는 읽기 전용, override는 SO가 설정·해제한다. */
export type Settings = { urlAutoFetch?: boolean; urlAutoFetchAvailable?: boolean; urlAllowDomains?: string[]; urlBlockDomains?: string[]; owuiTools?: 'auto' | 'off'; owuiDefaultTerminalId?: string | null; defaultModel?: string; defaultModelSource?: 'setting' | 'env' | 'default'; defaultModelOverride?: string | null; fileDelivery?: 'inline' | 'openwebui'; requestBudgetBytes?: number; srIntakeAssistantId?: string | null; link1Rule?: string; fileMaxPerRequest?: number; assistantImageFileId?: string | null }
/** assistantImageFileId는 PATCH가 아니라 uploadAssistantImage로만 바뀐다 (U4) */
export type SettingsPatch = Omit<Settings, 'defaultModel' | 'defaultModelSource' | 'assistantImageFileId' | 'urlAutoFetchAvailable'>
export const getSettings = async (): Promise<Settings> => {
  const response = await fetch('/api/settings', { credentials: 'same-origin' })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json() as Promise<Settings>
}
export const saveSettings = (patch: SettingsPatch) => adminRequest('settings', 'PATCH', patch)
/** AI 도우미 캐릭터 이미지 (SO) — null이면 제거 */
export async function uploadAssistantImage(file: File | null) {
  if (!file) return adminRequest('settings/assistant-image', 'DELETE')
  const form = new FormData(); form.append('file', file)
  const response = await fetch('/api/settings/assistant-image', { method: 'POST', credentials: 'same-origin', body: form })
  if (!response.ok) {
    const error: unknown = await response.json().catch(() => null)
    throw new Error(error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' ? error.message : `HTTP ${response.status}`)
  }
  return response.json() as Promise<Settings>
}
export const listManagedCodes = async () => CodeSchema.array().parse(await adminRequest('codes?includeInactive=true', 'GET'))
export const createCode = (input: { groupKey: string; code: string; name: string; sortOrder?: number }) => adminRequest('codes', 'POST', input)
export const updateCode = (id: string, patch: { name?: string; sortOrder?: number; active?: boolean }) => adminRequest(`codes/${encodeURIComponent(id)}`, 'PATCH', patch)
export type ManagedUser = { id: string; loginId: string | null; name: string; email: string | null; emailIsDefault: boolean; active: boolean; isSystemOwner: boolean; isBusinessOwner: boolean; mustChangePassword: boolean }
export const listManagedUsers = async () => await adminRequest('users', 'GET') as ManagedUser[]
export const setUserName = (id: string, name: string) => adminRequest(`users/${encodeURIComponent(id)}`, 'PATCH', { name })
export const setMyProfile = async (input: ProfilePatch) => ProfileSchema.parse(await adminRequest('users/me', 'PATCH', input))
export const setMyAccountProfile = async (input: ProfilePatch) => ProfileSchema.parse(await adminRequest('me', 'PATCH', input))
export const setMyName = (name: string) => setMyProfile({ name })
export const setUserFlag = (id: string, field: 'system-owner' | 'business-owner' | 'active', enabled: boolean) => adminRequest(`users/${encodeURIComponent(id)}/${field}`, 'PUT', { enabled })
export const temporaryPassword = async (id: string) => await adminRequest(`users/${encodeURIComponent(id)}/temporary-password`, 'POST') as { temporaryPassword: string }
export type TerminalSource = 'model' | 'global' | 'single' | 'none'
export type TerminalMeta = { terminalSource?: TerminalSource }
export const listOwuiTerminals = async () => await adminRequest('settings/owui-terminals', 'GET') as { id: string; name?: string }[]
/** 고정 출처 enum만 추가로 허용한다. 기존 계약은 나머지 진단 정보를 계속 검증한다. */
function terminalMeta(payload: unknown): TerminalMeta {
  const source = (payload as { meta?: { terminalSource?: unknown } } | null)?.meta?.terminalSource
  if (source === undefined) return {}
  if (source !== 'model' && source !== 'global' && source !== 'single' && source !== 'none') throw new Error('응답 형식 오류')
  return { terminalSource: source }
}
/** SO 전용 OpenWebUI 진단(S10-5) — 허용 목록(계약) 밖 값이 있으면 보여 주지 않는다. 검증 오류 문구는 값을 인용할 수 있어 고정 문구로 바꾼다 */
export async function probeOpenWebUi(model: string) {
  const payload = await adminRequest('admin/diagnostics/openwebui', 'POST', { model })
  const parsed = OwuiProbeResultSchema.safeParse(payload)
  if (!parsed.success) throw new Error('응답 형식 오류')
  return { ...parsed.data, meta: { ...parsed.data.meta, ...terminalMeta(payload) } }
}
/** SO 전용 연결 진단의 에이전트 접근 확인(S13-J) — 모델 호출 없이 접근·권한만. 같은 허용 목록 검사 */
export async function checkOpenWebUiAccess(model: string) {
  const payload = await adminRequest('admin/diagnostics/openwebui/access', 'POST', { model })
  const parsed = OwuiAccessCheckSchema.safeParse(payload)
  if (!parsed.success) throw new Error('응답 형식 오류')
  return { ...parsed.data, meta: { ...parsed.data.meta, ...terminalMeta(payload) } }
}

export async function probeOpenWebUiResponse(model: string) {
  const payload = await adminRequest('admin/diagnostics/openwebui/response-probe', 'POST', { model })
  const parsed = OwuiResponseProbeResultSchema.safeParse(payload)
  if (!parsed.success) throw new Error('응답 형식 오류')
  return parsed.data
}
