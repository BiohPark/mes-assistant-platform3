import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { createT } from '@/i18n'
import { focusPageTarget, PAGE_ACTIONS, pageRoute, pageTarget } from './pageActions'

it('every page, including other, starts with the guide action and My work has its own page', () => {
  for (const actions of Object.values(PAGE_ACTIONS)) expect(actions[0]).toEqual({ kind: 'tutorial', label: 'tutorial.guide' })
  expect(pageRoute('/my-work')).toBe('myWork')
  expect(pageRoute('/my-info')).toBe('other')
})

it.each(['ko', 'en'] as const)('opens the current %s materials panel without closing it and focuses the input', locale => {
  const t = createT(locale)
  render(<><input aria-label={t('hub.searchAssistants')} /><button data-tour="linked-materials" aria-expanded="false" onClick={event => event.currentTarget.setAttribute('aria-expanded', 'true')}>materials</button><div data-tour="composer"><textarea /></div></>)
  focusPageTarget('search', t)
  expect(screen.getByRole('textbox', { name: t('hub.searchAssistants') })).toHaveFocus()
  focusPageTarget('related', t)
  const toggle = pageTarget('materials', t)!
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  expect(toggle).toHaveFocus()
  focusPageTarget('materials', t)
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  focusPageTarget('chat', t)
  expect(document.querySelector('textarea')).toHaveFocus()
})

it('skips hidden and inert controls', () => {
  const t = createT('ko')
  render(<><div style={{ display: 'none' }}><button data-tour="linked-materials">hidden</button></div><button data-tour="linked-materials">visible</button></>)
  expect(pageTarget('materials', t)).toBe(screen.getByRole('button', { name: 'visible' }))
})

it('S15: 숨은 탭(inert)의 같은 검색창은 건너뛴다', () => {
  const t = createT('ko')
  const hidden = document.createElement('div')
  hidden.setAttribute('inert', '')
  hidden.innerHTML = `<input aria-label="${t('hub.searchAssistants')}">`
  const shown = document.createElement('input')
  shown.setAttribute('aria-label', t('hub.searchAssistants'))
  document.body.append(hidden, shown)
  expect(pageTarget('search', t)).toBe(shown)
  hidden.remove(); shown.remove()
})

it.each(['ko', 'en'] as const)('draft %s shared chat shortcut expands its existing preview summary', locale => {
  render(<details data-tour="related"><summary>preview</summary><div>shared chats</div></details>)
  focusPageTarget('related', createT(locale))
  expect(screen.getByText('preview').closest('details')).toHaveAttribute('open')
  expect(screen.getByText('preview')).toHaveFocus()
})
