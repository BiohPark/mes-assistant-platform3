import { useQuery } from '@tanstack/react-query'
import { getTask } from '@/api/tasks'
import { listAssistants } from '@/lib/catalog'
import { useT, type TranslationKey } from '@/i18n'
import { pathOf } from './tabs'

const TITLES = {
  '/': 'nav.hub', '/my-work': 'nav.myWork', '/sr': 'nav.sr', '/sr/manage': 'nav.srManage', '/reports': 'nav.reports',
  '/assistants/manage': 'nav.assistants', '/settings': 'nav.settings', '/admin/users': 'nav.users', '/admin/diagnostics': 'nav.diagnostics',
  '/password': 'common.changePassword', '/my-info': 'common.myInfo',
} as const satisfies Record<string, TranslationKey>
const param = (pattern: RegExp, path: string) => {
  const raw = pattern.exec(path)?.[1]
  try { return raw === undefined ? undefined : decodeURIComponent(raw) } catch { return raw }
}

/**
 * 탭 칩·문서 제목 — 메뉴 화면은 메뉴 이름, 대화는 '코드 · 제목'(화면과 같은 ['task'] 캐시), 새 대화는 '새 대화 · 에이전트'.
 * live가 아니면(화면이 내려간 탭) 조회·구독하지 않고 캐시에 남은 값이나 stored(저장된 칩 제목)를 쓴다 — 칩이 많아도 재조회는 살아 있는 탭만
 */
export function useTabTitle(href: string, live = true, stored?: string): string {
  const t = useT()
  const path = pathOf(href)
  const taskId = param(/^\/c\/([^/]+)\/?$/, path)
  const assistantId = param(/^\/new\/([^/]+)\/?$/, path)
  const task = useQuery({ queryKey: ['task', taskId], queryFn: () => getTask(taskId!), enabled: !!taskId && live, subscribed: live, retry: false })
  const assistants = useQuery({ queryKey: ['assistants'], queryFn: listAssistants, enabled: !!assistantId && live, subscribed: live })
  if (taskId) return task.data ? `${task.data.code} · ${task.data.title || t('task.conversation')}` : stored ?? t('task.conversation')
  if (assistantId) {
    const name = assistants.data?.find(item => item.id === assistantId)?.name
    return name ? t('hub.newConversationTitle', { name }) : stored ?? t('hub.newConversation')
  }
  const trimmed = path.replace(/(.)\/$/, '$1')
  return trimmed in TITLES ? t(TITLES[trimmed as keyof typeof TITLES]) : path
}
