import { expect, test } from '@playwright/test'

const password = 'e2e-password-1234'

test.describe('local 로그인 → 빈 허브', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/assistants', (route) => route.fulfill({ json: [] }))
  })
  test('담당자: 회원가입, 로그인 오류, 빈 허브, 로그아웃', async ({ page }) => {
    const loginId = `e2e-member-${Date.now()}`
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await page.getByRole('link', { name: '회원가입' }).click()
    await page.getByLabel('ID').fill(loginId)
    await page.getByLabel('비밀번호', { exact: true }).fill(password)
    await page.getByLabel('이름').fill(loginId)
    await page.getByLabel('비밀번호 확인').fill(password)
    await page.getByRole('button', { name: '회원가입' }).click()
    await expect(page).toHaveURL(/localhost:5173\/$/)
    await expect(page.getByRole('heading', { name: '에이전트 허브' })).toBeVisible()
    await expect(page.getByText('등록된 에이전트가 없습니다')).toBeVisible()
    expect((await (await page.request.get('/api/me')).json()).roles).toEqual(['member'])

    await page.getByRole('button', { name: new RegExp(loginId) }).click()
    await page.getByRole('menuitem', { name: '로그아웃' }).click()
    await expect(page.getByRole('heading', { name: '로그아웃했습니다' })).toBeVisible()
    expect((await page.request.get('/api/me')).status()).toBe(401)
    await page.getByRole('button', { name: '다시 로그인' }).click()
    await page.getByLabel('ID').fill(loginId)
    await page.getByLabel('비밀번호').fill('wrong-password')
    await page.getByRole('button', { name: '로그인' }).click()
    await expect(page.getByRole('alert')).toHaveText('ID 또는 비밀번호가 올바르지 않습니다')
    await page.getByLabel('비밀번호').fill(password)
    await page.getByRole('button', { name: '로그인' }).click()
    await expect(page.getByText('등록된 에이전트가 없습니다')).toBeVisible()
  })

  test('System Owner: dev-owner는 재실행 시에도 가입 또는 로그인', async ({ page }) => {
    await page.goto('/signup')
    await page.getByLabel('ID').fill('dev-owner')
    await page.getByLabel('비밀번호', { exact: true }).fill(password)
    await page.getByLabel('이름').fill('가상 사용자')
    await page.getByLabel('비밀번호 확인').fill(password)
    await page.getByRole('button', { name: '회원가입' }).click()
    await expect(page.getByRole('alert').or(page.getByText('등록된 에이전트가 없습니다'))).toBeVisible()
    if (await page.getByRole('alert').isVisible()) {
      await expect(page.getByRole('alert')).toHaveText('이미 사용 중인 ID입니다')
      await page.getByRole('link', { name: '로그인' }).click()
      await expect(page).toHaveURL(/\/login$/)
      await page.getByLabel('ID').fill('dev-owner')
      await page.getByLabel('비밀번호', { exact: true }).fill(password)
      await page.getByRole('button', { name: '로그인' }).click()
    }
    await expect(page.getByText('등록된 에이전트가 없습니다')).toBeVisible()
    expect((await (await page.request.get('/api/me')).json()).roles).toEqual(['member', 'system_owner'])
  })
})
