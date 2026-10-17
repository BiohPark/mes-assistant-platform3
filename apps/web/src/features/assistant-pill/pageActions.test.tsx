import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { createT } from '@/i18n'
import { focusPageTarget, PAGE_ACTIONS, pageRoute, pageTarget } from './pageActions'

it('every page, including other, starts with the guide action and My work has its own page', () => {
  for (const actions of Object.values(PAGE_ACTIONS)) expect(actions[0]).toEqual({ kind: 'tutorial', label: 'tutorial.guide' })
  expect(pageRoute('/my-work')).toBe('myWork')
  expect(pageRoute('/my-info')).toBe('other')
})

it.each(['ko', 'en'] as const)('focuses existing %s search and opens the same-tag panel without toggling it closed', locale => {
  const t = createT(locale)
  render(<><input aria-label={t('hub.searchAssistants')} /><details><summary>{t('task.related.linked', { count: 2 })}</summary><p>linked conversations</p></details></>)
  focusPageTarget('search', t)
  expect(screen.getByRole('textbox')).toHaveFocus()
  focusPageTarget('related', t)
  const summary = pageTarget('related', t)!
  expect(summary.parentElement).toHaveAttribute('open')
  expect(summary).toHaveFocus()
  focusPageTarget('related', t)
  expect(summary.parentElement).toHaveAttribute('open')
})

it('opens and focuses the visible materials tab at either layout breakpoint', () => {
  const t = createT('ko')
  render(<><div role="tablist" style={{ display: 'none' }}><button role="tab">{t('task.body.materials')}</button></div><div role="tablist"><button role="tab" onClick={event => event.currentTarget.setAttribute('aria-selected', 'true')}>{t('task.body.materials')}</button></div></>)
  focusPageTarget('materials', t)
  const tabs = screen.getAllByRole('tab', { hidden: true })
  expect(tabs[0]).not.toHaveAttribute('aria-selected', 'true')
  expect(tabs[1]).toHaveAttribute('aria-selected', 'true')
  expect(tabs[1]).toHaveFocus()
})

it('S14: 좁은 화면의 보이는 대화 탭을 연다(투어의 첨부 단계가 입력창을 짚도록)', () => {
  const t = createT('ko')
  render(<><div role="tablist" style={{ display: 'none' }}><button role="tab">{t('task.conversation')}</button></div><div role="tablist"><button role="tab" onClick={event => event.currentTarget.setAttribute('aria-selected', 'true')}>{t('task.conversation')}</button></div></>)
  focusPageTarget('chat', t)
  const tabs = screen.getAllByRole('tab', { hidden: true })
  expect(tabs[0]).not.toHaveAttribute('aria-selected', 'true')
  expect(tabs[1]).toHaveAttribute('aria-selected', 'true')
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
