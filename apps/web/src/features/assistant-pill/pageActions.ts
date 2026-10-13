import type { TranslationKey, Translator } from '@/i18n'

export type PageRoute = 'hub' | 'conversation' | 'sr' | 'admin' | 'other'
type MenuKey = Extract<TranslationKey, `pill.menu.${string}` | 'tutorial.replay'>
export type PageAction =
  | { kind: 'navigate'; label: MenuKey; to: string }
  | { kind: 'focus'; label: MenuKey; target: 'search' | 'related' | 'materials' }
  | { kind: 'prefill'; label: MenuKey; example: 'systemAssistant.exampleStart' | 'systemAssistant.exampleTagRelease' | 'admin.createAssistantExample' }
  | { kind: 'tutorial'; label: 'tutorial.replay' }

/** UI shortcuts only: no model requests, writes, or generated workflow instructions. */
export const PAGE_ACTIONS: Record<PageRoute, readonly PageAction[]> = {
  hub: [
    { kind: 'focus', label: 'pill.menu.search', target: 'search' },
    { kind: 'prefill', label: 'pill.menu.exampleStart', example: 'systemAssistant.exampleStart' },
    { kind: 'prefill', label: 'pill.menu.exampleTag', example: 'systemAssistant.exampleTagRelease' },
  ],
  conversation: [
    { kind: 'focus', label: 'pill.menu.related', target: 'related' },
    { kind: 'focus', label: 'pill.menu.materials', target: 'materials' },
    { kind: 'tutorial', label: 'tutorial.replay' },
  ],
  sr: [{ kind: 'navigate', label: 'pill.menu.mySr', to: '/sr' }],
  admin: [
    { kind: 'navigate', label: 'pill.menu.manageAgents', to: '/assistants/manage' },
    { kind: 'navigate', label: 'pill.menu.settings', to: '/settings' },
    { kind: 'navigate', label: 'pill.menu.users', to: '/admin/users' },
    { kind: 'navigate', label: 'pill.menu.diagnostics', to: '/admin/diagnostics' },
    { kind: 'prefill', label: 'pill.menu.exampleCreate', example: 'admin.createAssistantExample' },
  ],
  other: [],
}

export function pageRoute(pathname: string): PageRoute {
  if (pathname === '/') return 'hub'
  if (/^\/(c|new)\/[^/]+\/?$/.test(pathname)) return 'conversation'
  if (pathname === '/sr' || pathname === '/sr/manage') return 'sr'
  if (['/assistants/manage', '/settings', '/admin/users', '/admin/diagnostics'].includes(pathname)) return 'admin'
  return 'other'
}

// Existing controls expose translated accessible names. Keep the integration inside U5's owned files.
export function pageTarget(target: 'search' | 'related' | 'materials', t: Translator): HTMLElement | undefined {
  if (target === 'search') return Array.from(document.querySelectorAll<HTMLInputElement>('input')).find(input => input.getAttribute('aria-label') === t('hub.searchAssistants'))
  if (target === 'related') return Array.from(document.querySelectorAll<HTMLElement>('details > summary')).find(summary => summary.textContent?.startsWith(t('task.related.linked', { count: 0 }).split('0')[0]!))
  return Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]')).find(tab => tab.textContent?.trim() === t('task.body.materials') && getComputedStyle(tab.closest('[role="tablist"]') ?? tab).display !== 'none')
}

export function focusPageTarget(target: 'search' | 'related' | 'materials', t: Translator) {
  const element = pageTarget(target, t)
  if (target === 'related' && element?.parentElement instanceof HTMLDetailsElement && !element.parentElement.open) element.click()
  if (target === 'materials') element?.click()
  element?.focus()
}
