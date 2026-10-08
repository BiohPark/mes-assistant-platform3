import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { MeContext } from '@/app/auth'
import { TooltipProvider } from '@/components/ui/tooltip'
import { renderWithProviders } from '@/test/render'
import { PasswordPage } from './PasswordPage'

it('비밀번호 불일치 오류를 확인 입력의 Field 설명으로 연결한다', async () => {
  const user = userEvent.setup()
  renderWithProviders(<MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'], theme: 'system', locale: 'ko' }}><TooltipProvider><PasswordPage /></TooltipProvider></MeContext>)
  await user.type(screen.getByLabelText('현재 비밀번호'), 'current123')
  await user.type(screen.getByLabelText('새 비밀번호'), 'next12345')
  await user.type(screen.getByLabelText('새 비밀번호 확인'), 'different123')
  await user.click(screen.getByRole('button', { name: '변경' }))
  expect(screen.getByLabelText('새 비밀번호 확인')).toHaveAttribute('aria-invalid', 'true')
  expect(screen.getByLabelText('새 비밀번호 확인')).toHaveAccessibleDescription('새 비밀번호가 일치하지 않습니다')
})
