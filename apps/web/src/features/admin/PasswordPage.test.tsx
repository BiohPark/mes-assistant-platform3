import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { MeContext } from '@/app/auth'
import { TooltipProvider } from '@/components/ui/tooltip'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { PasswordPage } from './PasswordPage'

afterEach(() => vi.unstubAllGlobals())

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

it('서버 오류는 폼 하단 alert에 표시하고 확인 입력을 오류로 표시하지 않는다', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/auth/password' && init?.method === 'POST') return jsonResponse(400, { message: '현재 비밀번호가 올바르지 않습니다' })
    return jsonResponse(200, [])
  }))
  const user = userEvent.setup()
  renderWithProviders(<MeContext value={{ id: 'u', name: '사용자', role: '', roles: ['member'], theme: 'system', locale: 'ko' }}><TooltipProvider><PasswordPage /></TooltipProvider></MeContext>)
  await user.type(screen.getByLabelText('현재 비밀번호'), 'wrong1234')
  await user.type(screen.getByLabelText('새 비밀번호'), 'next12345')
  const confirm = screen.getByLabelText('새 비밀번호 확인')
  await user.type(confirm, 'different123')
  await user.click(screen.getByRole('button', { name: '변경' }))
  expect(confirm).toHaveAttribute('aria-invalid', 'true')
  await user.clear(confirm)
  await user.type(confirm, 'next12345')
  await user.click(screen.getByRole('button', { name: '변경' }))
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('현재 비밀번호가 올바르지 않습니다')
  expect(confirm).not.toHaveAttribute('aria-invalid', 'true')
  expect(confirm).not.toHaveAttribute('aria-describedby')
  const form = confirm.closest('form')!
  expect(alert.parentElement).toBe(form)
  expect(form.lastElementChild).toBe(alert)
})
