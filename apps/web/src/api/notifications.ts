export interface NotificationItem { id: string; userId: string; title: string; body: string; link: string; at: string; read: boolean }

async function request<T>(path: string, method = 'GET'): Promise<T> {
  const response = await fetch(`/api/notifications${path}`, { method, credentials: 'same-origin' })
  if (!response.ok) throw new Error(`알림 요청 실패 (HTTP ${response.status})`)
  if (method !== 'GET') return undefined as T
  return response.json() as Promise<T>
}

export const listNotifications = () => request<NotificationItem[]>('')
export const unreadCount = () => request<{ count: number }>('/unread-count')
export const markRead = (id: string) => request<void>(`/${encodeURIComponent(id)}/read`, 'PATCH')
export const markAllRead = () => request<void>('/read-all', 'POST')
