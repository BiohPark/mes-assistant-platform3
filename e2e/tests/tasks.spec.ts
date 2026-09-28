import { expect, test } from '@playwright/test'

const password = 'e2e-password-1234'

async function signUp(page: import('@playwright/test').Page, id: string) {
  await page.goto('/signup')
  await page.getByLabel('ID').fill(id)
  await page.getByLabel('비밀번호', { exact: true }).fill(password)
  await page.getByLabel('비밀번호 확인').fill(password)
  await page.getByRole('button', { name: '회원가입' }).click()
  await expect(page).toHaveURL(/\/$/) // 세션 쿠키가 잡힌 뒤(허브 도착) 다음 이동 — 곧바로 goto하면 로그인 전에 이동해 /login으로 튕긴다
}

test('대화 생성, 태그와 칸반, 완료와 재개, 다른 사용자 조회', async ({ page, browser }) => {
  await signUp(page, `e2e-task-${Date.now()}-a`)
  await page.getByRole('link', { name: /새 대화/ }).first().click()
  await expect(page).toHaveURL(/\/new\//)
  await page.getByRole('textbox', { name: '팀 의견 입력' }).fill('첫 팀 의견')
  await page.getByRole('button', { name: '전송', exact: true }).click()
  await expect(page).toHaveURL(/\/c\/[^/]+$/)
  await expect(page.getByText(/WK-\d{4}-\d{4}/).first()).toBeVisible()
  const taskUrl = page.url()
  const tag = `공유태그-${Date.now()}` // 실행마다 고유 — 개발 DB에 남은 이전 실행 대화와 칸반에서 섞이지 않게
  await page.getByRole('combobox', { name: '태그 입력' }).fill(tag)
  await page.getByRole('combobox', { name: '태그 입력' }).press('Enter')
  await expect(page.getByText(tag).first()).toBeVisible()
  await page.goto(`/?view=kanban&tag=${encodeURIComponent(tag)}`)
  await expect(page.getByRole('link', { name: /WK-\d{4}-\d{4}.*열기/ })).toBeVisible()
  await page.goto(taskUrl)
  await page.getByRole('button', { name: '업무 완료' }).click()
  await expect(page.getByRole('button', { name: '다시 열기' })).toBeVisible()
  await page.getByRole('button', { name: '다시 열기' }).click()
  await page.getByPlaceholder('사유를 입력하세요').fill('추가 확인')
  await page.getByRole('button', { name: '재개 확인' }).click()
  await expect(page.getByRole('button', { name: '업무 완료' })).toBeVisible()

  const other = await browser.newContext({ baseURL: new URL(page.url()).origin })
  try {
    const second = await other.newPage()
    await signUp(second, `e2e-task-${Date.now()}-b`)
    await second.goto(taskUrl)
    await expect(second.getByText('첫 팀 의견')).toBeVisible()
  } finally { await other.close() }
})
