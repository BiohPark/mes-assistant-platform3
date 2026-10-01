export interface SystemMessage { role: 'user' | 'assistant'; content: string }
export interface SystemReply { text: string; toolCalls: Array<{ id: string; name: string; arguments: string }> }

export async function getSystemModel(): Promise<{ mode: 'mock' | 'live'; model: string }> {
  const response = await fetch('/api/system-assistant/model', { credentials: 'same-origin' })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json() as Promise<{ mode: 'mock' | 'live'; model: string }>
}

export async function sendSystemMessage(messages: SystemMessage[], signal?: AbortSignal): Promise<SystemReply> {
  const response = await fetch('/api/system-assistant/messages', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages }), signal })
  if (!response.ok) {
    const error: unknown = await response.json().catch(() => null)
    throw new Error(error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' ? error.message : `HTTP ${response.status}`)
  }
  return response.json() as Promise<SystemReply>
}
