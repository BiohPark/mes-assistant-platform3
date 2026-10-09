/// <reference lib="dom" />
import { expect, test, type Page } from '@playwright/test'

test.use({ viewport: { width: 390, height: 844 } })

async function signUp(page: Page) {
  await page.goto('/signup')
  await page.getByLabel('ID').fill(`e2e-mobile-${Date.now()}`)
  await page.getByLabel('비밀번호', { exact: true }).fill('e2e-password-1234')
  await page.getByLabel('이름').fill('모바일 사용자')
  await page.getByLabel('비밀번호 확인').fill('e2e-password-1234')
  await page.getByRole('button', { name: '회원가입' }).click()
  await expect(page).toHaveURL(/\/$/)
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth })))
    .toEqual({ scroll: 390, client: 390 })
}

test('390px 허브의 필터는 내부에서 스크롤하고 선택 수와 초기화는 계속 보인다', async ({ page }) => {
  await signUp(page)
  await expect(page.getByRole('link', { name: /새 대화/ }).first()).toBeVisible()
  const firstFilter = page.getByRole('toolbar', { name: '업무 Lv1' }).getByRole('button').first()
  await firstFilter.click()
  await expect(page.getByText('선택됨 1', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '초기화', exact: true })).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await page.getByRole('button', { name: '초기화', exact: true }).click()
  await expect(firstFilter).toHaveAttribute('aria-pressed', 'false')
  await expectNoHorizontalOverflow(page)
})

test('390px 대화 헤더가 겹치지 않고 모델창과 관련 대화 펼침이 뷰포트 안에 들어간다', async ({ page }) => {
  await signUp(page)
  const assistantsResponse = await page.request.get('/api/assistants')
  expect(assistantsResponse.ok()).toBe(true)
  const assistants = await assistantsResponse.json() as Array<{ id: string }>
  expect(assistants.length).toBeGreaterThan(0)
  const tag = `모바일-${Date.now()}`
  const create = async () => {
    const response = await page.request.post('/api/tasks', { data: { assistantId: assistants[0]!.id, tags: [tag], title: '모바일 대화' } })
    expect(response.ok()).toBe(true)
    return await response.json() as { id: string; code: string }
  }
  const task = await create()
  for (let index = 0; index < 5; index++) await create()
  const modelId = 'mobile-model-with-a-very-long-provider-and-version-name'
  expect((await page.request.patch(`/api/tasks/${task.id}`, { data: { modelId } })).ok()).toBe(true)
  await page.goto(`/c/${task.id}`)
  await expect(page.getByRole('button', { name: '업무 완료' })).toBeVisible()
  await expectNoHorizontalOverflow(page)
  const metadata = await page.getByText(task.code, { exact: true }).locator('..').boundingBox()
  const complete = await page.getByRole('button', { name: '업무 완료' }).locator('..').boundingBox()
  expect(metadata).not.toBeNull()
  expect(complete).not.toBeNull()
  expect(complete!.y).toBeGreaterThanOrEqual(metadata!.y + metadata!.height)
  const trigger = page.getByTitle('이 대화의 모델 변경')
  await expect(trigger).toContainText(modelId)
  await trigger.click()
  const popup = page.getByRole('button', { name: '모델 목록 새로고침' }).locator('../..')
  await expect(popup).toBeVisible()
  const modelBox = await popup.boundingBox()
  expect(modelBox).not.toBeNull()
  expect(modelBox!.x).toBeGreaterThanOrEqual(0)
  expect(modelBox!.x + modelBox!.width).toBeLessThanOrEqual(390)
  await expectNoHorizontalOverflow(page)
  await trigger.click()
  const related = page.locator('summary').filter({ hasText: '같은 태그 대화 5' })
  await expect(related).toContainText('+2')
  await related.click()
  const relatedPopup = related.locator('..').locator(':scope > div')
  await expect(relatedPopup.getByRole('link')).toHaveCount(5)
  const relatedBox = await relatedPopup.boundingBox()
  expect(relatedBox).not.toBeNull()
  expect(relatedBox!.x).toBeGreaterThanOrEqual(0)
  expect(relatedBox!.x + relatedBox!.width).toBeLessThanOrEqual(390)
  await expectNoHorizontalOverflow(page)
})
