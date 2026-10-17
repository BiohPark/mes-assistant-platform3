import type { TranslationKey, Translator } from '@/i18n'

export type PageRoute = 'hub' | 'conversation' | 'sr' | 'myWork' | 'admin' | 'other'
type MenuKey = Extract<TranslationKey, `pill.menu.${string}`>
export type PageAction =
  | { kind: 'navigate'; label: MenuKey; to: string }
  | { kind: 'focus'; label: MenuKey; target: 'search' | 'related' | 'materials' }
  | { kind: 'prefill'; label: MenuKey; example: 'systemAssistant.exampleStart' | 'systemAssistant.exampleTagRelease' | 'admin.createAssistantExample' }
  | { kind: 'tutorial'; label: 'tutorial.guide' }

const GUIDE = { kind: 'tutorial', label: 'tutorial.guide' } as const satisfies PageAction
const HUB = { kind: 'navigate', label: 'pill.menu.hub', to: '/' } as const satisfies PageAction
const MY_WORK = { kind: 'navigate', label: 'pill.menu.myWork', to: '/my-work' } as const satisfies PageAction

/** UI shortcuts only: no model requests, writes, or generated workflow instructions. The guide (spotlight tour) comes first on every page. */
export const PAGE_ACTIONS: Record<PageRoute, readonly PageAction[]> = {
  hub: [
    GUIDE,
    { kind: 'focus', label: 'pill.menu.search', target: 'search' },
    { kind: 'prefill', label: 'pill.menu.exampleStart', example: 'systemAssistant.exampleStart' },
    { kind: 'prefill', label: 'pill.menu.exampleTag', example: 'systemAssistant.exampleTagRelease' },
    MY_WORK,
  ],
  conversation: [
    GUIDE,
    { kind: 'focus', label: 'pill.menu.related', target: 'related' },
    { kind: 'focus', label: 'pill.menu.materials', target: 'materials' },
    MY_WORK,
  ],
  sr: [GUIDE, { kind: 'navigate', label: 'pill.menu.mySr', to: '/sr' }],
  myWork: [GUIDE, HUB],
  admin: [
    GUIDE,
    { kind: 'navigate', label: 'pill.menu.manageAgents', to: '/assistants/manage' },
    { kind: 'navigate', label: 'pill.menu.settings', to: '/settings' },
    { kind: 'navigate', label: 'pill.menu.users', to: '/admin/users' },
    { kind: 'navigate', label: 'pill.menu.diagnostics', to: '/admin/diagnostics' },
    { kind: 'prefill', label: 'pill.menu.exampleCreate', example: 'admin.createAssistantExample' },
  ],
  other: [GUIDE, HUB],
}

export function pageRoute(pathname: string): PageRoute {
  if (pathname === '/') return 'hub'
  if (/^\/(c|new)\/[^/]+\/?$/.test(pathname)) return 'conversation'
  if (pathname === '/sr' || pathname === '/sr/manage') return 'sr'
  if (pathname === '/my-work') return 'myWork'
  if (['/assistants/manage', '/settings', '/admin/users', '/admin/diagnostics'].includes(pathname)) return 'admin'
  return 'other'
}

// Existing controls expose translated accessible names. Keep the integration inside U5's owned files.
export function pageTarget(target: 'search' | 'related' | 'materials' | 'chat', t: Translator): HTMLElement | undefined {
  if (target === 'search') return shown<HTMLInputElement>('input').find(input => input.getAttribute('aria-label') === t('hub.searchAssistants'))
  if (target === 'related') return shown<HTMLElement>('details > summary').find(summary => summary.textContent?.startsWith(t('task.related.linked', { count: 0 }).split('0')[0]!))
  // 보이는 탭 목록의 탭만 — 자료 탭은 두 분기점 모두, 대화 탭은 좁은 화면에만 있다
  const label = t(target === 'chat' ? 'task.conversation' : 'task.body.materials')
  return shown<HTMLElement>('[role="tab"]').find(tab => tab.textContent?.trim() === label && getComputedStyle(tab.closest('[role="tablist"]') ?? tab).display !== 'none')
}
/** 숨은 탭(S15, inert)의 화면은 빼고 찾는다 */
const shown = <E extends Element>(selector: string) => Array.from(document.querySelectorAll<E>(selector)).filter(element => !element.closest('[inert]'))

export function focusPageTarget(target: 'search' | 'related' | 'materials' | 'chat', t: Translator) {
  const element = pageTarget(target, t)
  if (target === 'related' && element?.parentElement instanceof HTMLDetailsElement && !element.parentElement.open) element.click()
  if (target === 'materials' || target === 'chat') element?.click()
  element?.focus()
}
