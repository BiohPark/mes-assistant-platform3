import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { expect, it } from 'vitest'
import { I18nProvider } from '@/i18n'
import { AnswerChoices } from './AnswerChoices'

function Harness({ locale = 'ko' }: { locale?: 'ko' | 'en' }) {
  const [selected, setSelected] = useState('')
  return <I18nProvider locale={locale}><AnswerChoices items={['요약', '상세', '원문']} onChoose={setSelected} /><input aria-label="draft" value={selected} onChange={event => setSelected(event.target.value)} /></I18nProvider>
}

it('exposes numbered choices in an accessible group and selects by click, Enter and Space', async () => {
  render(<Harness />)
  const user = userEvent.setup()
  const group = screen.getByRole('group', { name: '선택지' })
  const buttons = within(group).getAllByRole('button')
  expect(buttons.map(button => button.textContent)).toEqual(['1. 요약', '2. 상세', '3. 원문'])
  await user.click(buttons[0]!)
  expect(screen.getByRole('textbox')).toHaveValue('요약')
  buttons[1]!.focus()
  await user.keyboard('{Enter}')
  expect(screen.getByRole('textbox')).toHaveValue('상세')
  buttons[2]!.focus()
  await user.keyboard(' ')
  expect(screen.getByRole('textbox')).toHaveValue('원문')
})

it('moves focus with arrows and handles numbers only inside the choice group', async () => {
  render(<Harness />)
  const user = userEvent.setup()
  const buttons = within(screen.getByRole('group', { name: '선택지' })).getAllByRole('button')
  buttons[0]!.focus()
  await user.keyboard('{ArrowRight}')
  expect(buttons[1]).toHaveFocus()
  await user.keyboard('{ArrowLeft}{ArrowLeft}')
  expect(buttons[2]).toHaveFocus()
  await user.keyboard('2')
  expect(screen.getByRole('textbox')).toHaveValue('상세')
  await user.click(screen.getByRole('textbox'))
  await user.keyboard('1')
  expect(screen.getByRole('textbox')).toHaveValue('상세1')
  buttons[0]!.focus()
  await user.keyboard('6')
  expect(screen.getByRole('textbox')).toHaveValue('상세1')
})

it('labels the group in English', () => {
  render(<Harness locale="en" />)
  expect(screen.getByRole('group', { name: 'Choices' })).toBeInTheDocument()
})
