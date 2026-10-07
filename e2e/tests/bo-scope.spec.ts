import { expect, test } from '@playwright/test'

test('BO 로그인은 SR 접수로 가고 허브 접근도 SR 접수로 돌린다', async ({ browser, page }) => {
  const loginId = `e2e-bo-${Date.now()}`
  const password = 'e2e-password-1234'
  const signup = await page.request.post('/api/auth/signup', { data: { loginId, name: '가상 요청자', password } })
  expect(signup.ok()).toBe(true)
  const id = ((await signup.json()) as { id: string }).id
  const owner = await browser.newContext({ baseURL: process.env.APP_ORIGIN ?? 'http://localhost:5173' })
  try {
    expect((await owner.request.post('/api/auth/login', { data: { loginId: 'dev-owner', password } })).ok()).toBe(true)
    expect((await owner.request.put(`/api/users/${id}/business-owner`, { data: { enabled: true } })).status()).toBe(204)
  } finally { await owner.close() }
  await page.goto('/login')
  await page.getByLabel('ID').fill(loginId)
  await page.getByLabel('비밀번호').fill(password)
  await page.getByRole('button', { name: '로그인' }).click()
  await expect(page).toHaveURL(/\/sr$/)
  await expect(page.getByRole('link', { name: 'SR 접수' })).toBeVisible()
  await expect(page.getByRole('link', { name: '에이전트 허브' })).toHaveCount(0)
  for (const path of ['/api/assistants', '/api/assistants/stats', '/api/catalog/users', '/api/codes', '/api/settings', '/api/tasks', '/api/reports']) {
    expect((await page.request.get(path)).status(), path).toBe(403)
  }
  expect((await page.request.post('/api/tasks', { data: { assistantId: 'urs-analyst' } })).status()).toBe(403)
  const intake = await page.request.get('/api/service-requests/intake-assistant')
  expect(intake.status()).toBe(200)
  expect(await intake.json()).toHaveProperty('srIntakeAssistantId')
  await page.goto('/')
  await expect(page).toHaveURL(/\/sr$/)
})
