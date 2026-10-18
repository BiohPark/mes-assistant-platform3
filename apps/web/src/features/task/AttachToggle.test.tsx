import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { I18nProvider } from '@/i18n'
import { AttachToggle, UsedMark } from './AttachToggle'

it('담기 버튼은 항목명과 표시 상태를 접근성 이름에 담고 선택을 알린다', () => {
  const onToggle = vi.fn()
  const { rerender } = render(<AttachToggle inputLabels label="spec.txt" attached={false} onToggle={onToggle} />)
  const button = screen.getByRole('button', { name: '+ 입력창에 담기 · spec.txt' })
  expect(button).toHaveAttribute('aria-pressed', 'false')
  expect(button).toHaveTextContent('+ 입력창에 담기')
  fireEvent.click(button)
  expect(onToggle).toHaveBeenCalledOnce()
  rerender(<AttachToggle inputLabels label="spec.txt" attached onToggle={onToggle} />)
  expect(screen.getByRole('button', { name: '담김 ✓ · spec.txt' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: '담김 ✓ · spec.txt' })).toHaveTextContent('담김 ✓')
  expect(screen.getByText('입력창에 spec.txt이 담겼습니다')).toHaveAttribute('aria-live', 'polite')
})

it('누르는 영역은 32px(h-8)이고 비활성화할 수 있다', () => {
  renderWithProviders(<AttachToggle inputLabels label="spec.txt" attached={false} disabled onToggle={() => {}} />)
  const button = screen.getByRole('button', { name: '+ 입력창에 담기 · spec.txt' })
  expect(button).toHaveClass('h-8')
  expect(button).toBeDisabled()
})

it('사용됨은 작은 표시이고 설명은 툴팁(title)에 둔다', () => {
  renderWithProviders(<UsedMark testId="used-f" />)
  const mark = screen.getByTestId('used-f')
  expect(mark).toHaveTextContent('사용됨')
  expect(mark).toHaveAttribute('title', '이 대화의 질문에 함께 보낸 적이 있습니다')
  expect(mark).toHaveClass('text-muted-foreground')
})

it.each(['ko', 'en'] as const)('input toggle %s accessible name includes visible action and item in both states', locale => {
  const { rerender } = render(<I18nProvider locale={locale}><AttachToggle inputLabels label="spec.txt" attached={false} onToggle={() => {}} /></I18nProvider>)
  const button = screen.getByRole('button')
  expect(button).toHaveAccessibleName(`${locale === 'ko' ? '+ 입력창에 담기' : '+ Add to Input'} · spec.txt`)
  rerender(<I18nProvider locale={locale}><AttachToggle inputLabels label="spec.txt" attached onToggle={() => {}} /></I18nProvider>)
  expect(button).toHaveAccessibleName(`${locale === 'ko' ? '담김 ✓' : 'Added ✓'} · spec.txt`)
})
