import { expect, test } from '@playwright/test'

// Keycloak 개발 realm의 가상 사용자 (docker/keycloak/mes-dev-realm.json)
const password = process.env.DEV_USER_PASSWORD ?? ''

test.describe('S0 — 로그인 → 빈 허브', () => {
  test.beforeAll(() => {
    expect(password, '.env의 DEV_USER_PASSWORD가 필요합니다').not.toBe('')
  })

  test('담당자: SSO 로그인 후 빈 허브, 로그아웃', async ({ page }) => {
    await page.goto('/')
    // 세션이 없으면 Keycloak 로그인 화면으로 간다
    await page.locator('#username').fill('dev-member')
    await page.locator('#password').fill(password)
    await page.locator('#kc-login').click()

    await expect(page).toHaveURL(/localhost:5173\/$/)
    await expect(page.getByRole('heading', { name: '에이전트 허브' })).toBeVisible()
    await expect(page.getByText('등록된 에이전트가 없습니다')).toBeVisible()

    const me = await page.request.get('/api/me')
    expect(me.status()).toBe(200)
    expect((await me.json()).roles).toEqual(['member'])

    await page.getByRole('button', { name: /이담당/ }).click()
    await page.getByRole('menuitem', { name: '로그아웃' }).click()
    await expect(page.getByRole('heading', { name: '로그아웃했습니다' })).toBeVisible()
    expect((await page.request.get('/api/me')).status()).toBe(401)
  })

  test('System Owner: INITIAL_SYSTEM_OWNERS 사용자는 system_owner 역할', async ({ page }) => {
    await page.goto('/')
    await page.locator('#username').fill('dev-owner')
    await page.locator('#password').fill(password)
    await page.locator('#kc-login').click()
    await expect(page.getByText('등록된 에이전트가 없습니다')).toBeVisible()
    const me = await (await page.request.get('/api/me')).json()
    expect(me.roles).toEqual(['member', 'system_owner'])
  })
})
