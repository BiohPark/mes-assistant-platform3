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

/** 탭 칩·문서 제목 — 메뉴 화면은 메뉴 이름, 대화는 '코드 · 제목'(화면과 같은 ['task'] 캐시), 새 대화는 '새 대화 · 에이전트' */
export function useTabTitle(href: string): string {
  const t = useT()
  const path = pathOf(href)
  const taskId = param(/^\/c\/([^/]+)\/?$/, path)
  const assistantId = param(/^\/new\/([^/]+)\/?$/, path)
  const task = useQuery({ queryKey: ['task', taskId], queryFn: () => getTask(taskId!), enabled: !!taskId, retry: false })
  const assistants = useQuery({ queryKey: ['assistants'], queryFn: listAssistants, enabled: !!assistantId })
  if (taskId) return task.data ? `${task.data.code} · ${task.data.title || t('task.conversation')}` : t('task.conversation')
  if (assistantId) {
    const name = assistants.data?.find(item => item.id === assistantId)?.name
    return name ? t('hub.newConversationTitle', { name }) : t('hub.newConversation')
  }
  const trimmed = path.replace(/(.)\/$/, '$1')
  return trimmed in TITLES ? t(TITLES[trimmed as keyof typeof TITLES]) : path
}
