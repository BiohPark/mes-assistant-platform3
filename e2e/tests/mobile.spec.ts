import { linkedMaterialsToggle, revealMaterials } from './materials.js'
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

test('390px 허브는 분류 팝오버에서 고른 것만 칩으로 보이고 선택 수·초기화는 필터가 있을 때만 보인다', async ({ page }) => {
  await signUp(page)
  await expect(page.getByRole('link', { name: /새 대화/ }).first()).toBeVisible()
  await expect(page.getByText(/^선택됨/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: '초기화', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '분류', exact: true }).click()
  const firstFilter = page.getByRole('toolbar', { name: '업무 Lv1' }).getByRole('button').first()
  const label = (await firstFilter.textContent())!.trim()
  await firstFilter.click()
  await expect(firstFilter).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('toolbar', { name: '업무 Lv1' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: `${label} 해제`, exact: true })).toBeVisible()
  await expect(page.getByText('선택됨 1', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '초기화', exact: true })).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await page.getByRole('button', { name: '초기화', exact: true }).click()
  await expect(page.getByRole('button', { name: `${label} 해제`, exact: true })).toHaveCount(0)
  await expect(page.getByText(/^선택됨/)).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
})

test('390px 대화 헤더는 한 줄로 가로 스크롤하고 모델창과 연결 자료가 뷰포트 안에 들어간다', async ({ page }) => {
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
  const complete = page.getByRole('button', { name: '업무 완료' })
  await expect(complete).toBeVisible()
  await expectNoHorizontalOverflow(page)
  // 제목은 헤더 한 줄에 있고 코드는 더 보기 메뉴에 있다.
  await expect(page.getByRole('button', { name: '모바일 대화', exact: true })).toBeVisible()
  const row = complete.locator('..').locator('..')
  await expect(row).toHaveCSS('overflow-x', 'auto')
  const agentBox = await row.locator(':scope > a').first().boundingBox()
  const completeBox = await complete.boundingBox()
  expect(agentBox).not.toBeNull()
  expect(completeBox).not.toBeNull()
  expect(Math.abs((agentBox!.y + agentBox!.height / 2) - (completeBox!.y + completeBox!.height / 2))).toBeLessThanOrEqual(4)
  // 모델 선택은 입력창 왼쪽 아래 — 긴 모델명은 pill 안에서 말줄임되고(문서는 390 그대로), 위로 펼친 목록이 뷰포트 안에 든다
  const trigger = page.getByTitle('이 대화의 모델 변경')
  await expect(trigger).toContainText(modelId)
  const triggerBox = await trigger.boundingBox()
  expect(triggerBox).not.toBeNull()
  expect(triggerBox!.x + triggerBox!.width).toBeLessThanOrEqual(390)
  await expect(trigger.getByText(modelId)).toHaveCSS('text-overflow', 'ellipsis')
  // 좁은 화면에서 대화 탭이 아니면 헤더의 검색·질문 목차 아이콘은 숨는다
  const searchToggle = page.getByRole('button', { name: '대화 내 검색' })
  await expect(searchToggle).toBeVisible()
  const materialsToggle = linkedMaterialsToggle(page)
  await expect(materialsToggle).toHaveAttribute('aria-expanded', 'false')
  const bar = page.getByRole('complementary', { name: '#태그·SR 연결 자료' })
  await expect(bar.locator(':scope > details')).not.toHaveAttribute('open')
  const collapsedBox = await bar.boundingBox()
  expect(collapsedBox!.height).toBeLessThan(100)
  await bar.locator(':scope > details > summary').click()
  await expect(materialsToggle).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('complementary', { name: '#태그·SR 연결 자료' })).toBeVisible()
  await expect(searchToggle).toBeVisible()
  await linkedMaterialsToggle(page).click()
  await expect(searchToggle).toBeVisible()
  await trigger.click()
  const popup = page.getByRole('dialog', { name: 'AI 모델' })
  await expect(popup).toBeVisible()
  const modelBox = await popup.boundingBox()
  expect(modelBox).not.toBeNull()
  expect(modelBox!.x).toBeGreaterThanOrEqual(0)
  expect(modelBox!.x + modelBox!.width).toBeLessThanOrEqual(390)
  expect(modelBox!.y).toBeGreaterThanOrEqual(0)
  expect(modelBox!.y + modelBox!.height).toBeLessThanOrEqual(844)
  await expectNoHorizontalOverflow(page)
  await page.keyboard.press('Escape')
  await expect(popup).toHaveCount(0)
  await revealMaterials(page)
  const conversations = page.locator('[data-tour="materials-conversations"]')
  await conversations.scrollIntoViewIfNeeded()
  await expect(conversations).toContainText('#태그 공유 대화 5개')
  await expect(page.getByTestId('conversation-candidates').locator('[data-testid^="conversation-"]')).toHaveCount(5)
  const materialsBox = await page.getByRole('complementary', { name: '#태그·SR 연결 자료' }).boundingBox()
  expect(materialsBox).not.toBeNull()
  expect(materialsBox!.height).toBeLessThanOrEqual(844 / 2)
  expect(materialsBox!.x).toBeGreaterThanOrEqual(0)
  expect(materialsBox!.x + materialsBox!.width).toBeLessThanOrEqual(390)
  await expectNoHorizontalOverflow(page)
})
