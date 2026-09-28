import { expect, test } from '@playwright/test'

test('로그인 후 시드 카탈로그 카드·검색·Lv1 필터', async ({ page }) => {
  const loginId = `e2e-catalog-${Date.now()}`
  await page.goto('/signup')
  await page.getByLabel('ID').fill(loginId)
  await page.getByLabel('비밀번호', { exact: true }).fill('e2e-password-1234')
  await page.getByLabel('비밀번호 확인').fill('e2e-password-1234')
  await page.getByRole('button', { name: '회원가입' }).click()

  await expect(page.getByRole('link', { name: /새 대화/ })).toHaveCount(12)
  await page.getByPlaceholder('이름 · 요약 · 업무 분류 검색').fill('프로토콜')
  await expect(page.getByRole('link', { name: /새 대화/ })).toHaveCount(1)
  await page.getByPlaceholder('이름 · 요약 · 업무 분류 검색').fill('')
  await page.getByRole('radio', { name: 'Record' }).click()
  await expect(page.getByRole('link', { name: /새 대화/ })).toHaveCount(4)
})
