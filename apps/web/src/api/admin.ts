import { AssistantSchema, CodeSchema, ProfileSchema, type Assistant, type ProfilePatch } from '@mes/contracts'

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
export type AssistantInput = Pick<Assistant, 'id' | 'name' | 'level1CodeId' | 'level2CodeId' | 'summary' | 'ownerId' | 'status' | 'usageExample' | 'expectedInputs' | 'expectedOutputs' | 'checklistTemplate'> & {
  modelId?: string | null; link1?: string | null; docUrl?: string | null
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
export type Settings = { defaultModel?: string; fileDelivery?: 'inline' | 'openwebui'; requestBudgetBytes?: number; srIntakeAssistantId?: string | null; link1Rule?: string; fileMaxPerRequest?: number }
export const getSettings = async (): Promise<Settings> => {
  const response = await fetch('/api/settings', { credentials: 'same-origin' })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json() as Promise<Settings>
}
export const saveSettings = (patch: Settings) => adminRequest('settings', 'PATCH', patch)
export const listManagedCodes = async () => CodeSchema.array().parse(await adminRequest('codes?includeInactive=true', 'GET'))
export const createCode = (input: { groupKey: string; code: string; name: string; sortOrder?: number }) => adminRequest('codes', 'POST', input)
export const updateCode = (id: string, patch: { name?: string; sortOrder?: number; active?: boolean }) => adminRequest(`codes/${encodeURIComponent(id)}`, 'PATCH', patch)
export type ManagedUser = { id: string; loginId: string | null; name: string; active: boolean; isSystemOwner: boolean; isBusinessOwner: boolean; mustChangePassword: boolean }
export const listManagedUsers = async () => await adminRequest('users', 'GET') as ManagedUser[]
export const setUserName = (id: string, name: string) => adminRequest(`users/${encodeURIComponent(id)}`, 'PATCH', { name })
export const setMyProfile = async (input: ProfilePatch) => ProfileSchema.parse(await adminRequest('users/me', 'PATCH', input))
export const setMyName = (name: string) => setMyProfile({ name })
export const setUserFlag = (id: string, field: 'system-owner' | 'business-owner' | 'active', enabled: boolean) => adminRequest(`users/${encodeURIComponent(id)}/${field}`, 'PUT', { enabled })
export const temporaryPassword = async (id: string) => await adminRequest(`users/${encodeURIComponent(id)}/temporary-password`, 'POST') as { temporaryPassword: string }
