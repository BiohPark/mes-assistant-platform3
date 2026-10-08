import { expect, test, type Page } from '@playwright/test'

const password = 'e2e-password-1234'
const appOrigin = process.env.APP_ORIGIN ?? 'http://localhost:5173'

async function owner(page: Page) {
  const signup = await page.request.post('/api/auth/signup', { data: { loginId: 'dev-owner', password } })
  if (signup.status() === 409) expect((await page.request.post('/api/auth/login', { data: { loginId: 'dev-owner', password } })).ok()).toBe(true)
  else expect(signup.ok()).toBe(true)
}
async function member(page: Page) {
  const loginId = `e2e-nav-${Date.now().toString(36)}`
  const response = await page.request.post('/api/auth/signup', { data: { loginId, password } })
  expect(response.ok()).toBe(true)
  return { loginId, id: (await response.json()).id as string }
}
const nav = (page: Page) => page.getByRole('navigation')
const headings = (page: Page) => nav(page).locator('p')

test('SO 사이드바: 업무·요청·관리 3구획 8개 메뉴, 사용자 관리와 전역 설정이 분리돼 있다', async ({ page }) => {
  await owner(page)
  await page.goto('/')
  await expect(nav(page).getByRole('link')).toHaveText(['에이전트 허브', 'SR 처리', '리포트', '내 SR 요청', '에이전트 관리', '전역 설정', '사용자 관리', '연결 진단'])
  await expect(headings(page)).toHaveText(['업무', '요청', '관리'])

  await nav(page).getByRole('link', { name: '사용자 관리' }).click()
  await expect(page).toHaveURL(/\/admin\/users$/)
  await expect(page.getByRole('heading', { name: '사용자 관리' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '사용자·역할' })).toBeVisible()
  await expect(page.getByRole('switch', { name: /SO$/ }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: '설정 저장' })).toHaveCount(0)

  await nav(page).getByRole('link', { name: '전역 설정' }).click()
  await expect(page).toHaveURL(/\/settings$/)
  await expect(page.getByRole('heading', { name: '전역 설정' })).toHaveCount(2) // TopBar 제목 + 폼 제목
  await expect(page.getByRole('button', { name: '설정 저장' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '사용자·역할' })).toHaveCount(0)
  const summary = page.getByRole('region', { name: 'AI 연결 요약' })
  await expect(summary.getByText(/^(Mock|Live)$/)).toBeVisible()
  await summary.getByRole('link', { name: '연결 진단 열기' }).click()
  await expect(page).toHaveURL(/\/admin\/diagnostics$/)
  await expect(page.getByRole('heading', { name: '연결 진단' })).toBeVisible()
  await expect(page.getByRole('button', { name: '다시 확인' })).toBeVisible()
})

test('담당자 사이드바: 업무 3개 + 요청 1개, 관리 구획 없음, /admin/users는 허브로 돌린다', async ({ page }) => {
  await member(page)
  await page.goto('/')
  await expect(nav(page).getByRole('link')).toHaveText(['에이전트 허브', 'SR 처리', '리포트', '내 SR 요청'])
  await expect(headings(page)).toHaveText(['업무', '요청'])
  await page.goto('/admin/users')
  await expect(page).toHaveURL(/localhost:5173\/$/)
  expect((await page.request.get('/api/users')).status()).toBe(403)
})

test('BO 사이드바: 내 SR 요청 1개뿐이고 구획 머리말이 없다', async ({ browser, page }) => {
  const { id, loginId } = await member(page)
  const admin = await browser.newContext({ baseURL: appOrigin })
  try {
    const signup = await admin.request.post('/api/auth/signup', { data: { loginId: 'dev-owner', password } })
    if (signup.status() === 409) expect((await admin.request.post('/api/auth/login', { data: { loginId: 'dev-owner', password } })).ok()).toBe(true)
    else expect(signup.ok()).toBe(true)
    expect((await admin.request.put(`/api/users/${id}/business-owner`, { data: { enabled: true } })).status()).toBe(204)
  } finally { await admin.close() }
  await page.request.post('/api/auth/logout')
  await page.goto('/login')
  await page.getByLabel('ID').fill(loginId)
  await page.getByLabel('비밀번호').fill(password)
  await page.getByRole('button', { name: '로그인' }).click()
  await expect(page).toHaveURL(/\/sr$/)
  await expect(nav(page).getByRole('link')).toHaveText(['내 SR 요청'])
  await expect(headings(page)).toHaveCount(0)
  await page.goto('/admin/users')
  await expect(page).toHaveURL(/\/sr$/)
})
