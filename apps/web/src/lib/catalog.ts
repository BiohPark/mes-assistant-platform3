import { AssistantSchema, AssistantStatsSchema, CatalogUserSchema, CodeSchema } from '@mes/contracts'

async function get(path: string): Promise<unknown> {
  const response = await fetch(path, { credentials: 'same-origin' })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

export async function listAssistants() { return AssistantSchema.array().parse(await get('/api/assistants')) }
export async function listAssistantStats() { return AssistantStatsSchema.array().parse(await get('/api/assistants/stats')) }
export async function listUsers() { return CatalogUserSchema.array().parse(await get('/api/catalog/users')) }
export async function listCodes(group?: string) { return CodeSchema.array().parse(await get(`/api/codes${group ? `?group=${encodeURIComponent(group)}` : ''}`)) }
