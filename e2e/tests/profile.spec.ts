import { expect, test } from '@playwright/test'

test('사용자 메뉴의 다크·언어 전환은 서버에 저장되고 새 브라우저에서도 적용된다', async ({ page, browser }) => {
  const loginId = `e2e-profile-${Date.now().toString(36)}`
  const password = 'e2e-password-1234'
  const signup = await page.request.post('/api/auth/signup', { data: { loginId, password, name: '프로필 사용자' } })
  expect(signup.ok()).toBe(true)
  await page.goto('/')
  await page.getByRole('button', { name: /프로필 사용자/ }).click()
  await page.getByRole('menuitemradio', { name: '다크' }).click()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect.poll(async () => (await (await page.request.get('/api/me')).json()).theme).toBe('dark')
  await page.getByRole('button', { name: /프로필 사용자/ }).click()
  await page.getByRole('menuitemradio', { name: 'English' }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect.poll(async () => (await (await page.request.get('/api/me')).json()).locale).toBe('en')
  await page.reload()
  await expect(page.getByRole('button', { name: /프로필 사용자/ })).toBeVisible()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  const context = await browser.newContext({ baseURL: process.env.APP_ORIGIN ?? 'http://localhost:5173', colorScheme: 'light' })
  try {
    const next = await context.newPage()
    expect((await context.request.post('/api/auth/login', { data: { loginId, password } })).ok()).toBe(true)
    await next.goto('/my-info')
    await expect(next.getByRole('radio', { name: '다크' })).toBeChecked()
    await expect(next.locator('html')).toHaveClass(/dark/)
    await expect(next.locator('html')).toHaveAttribute('lang', 'en')
    await next.locator('label').filter({ has: next.getByRole('radio', { name: '라이트' }) }).click() // 입력은 시각적으로 숨겨지고 label이 누름 영역
    await expect(next.locator('html')).not.toHaveClass(/dark/)
    await expect.poll(async () => (await (await context.request.get('/api/me')).json()).theme).toBe('light')
  } finally { await context.close() }
})
