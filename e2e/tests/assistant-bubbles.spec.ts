import { expect, test, type Page } from '@playwright/test'

const password = 'e2e-password-1234'
async function signup(page: Page) {
  const id = `bubble-${Date.now()}`.slice(0, 32)
  await page.goto('/signup')
  await page.getByLabel('ID').fill(id)
  await page.getByLabel('비밀번호', { exact: true }).fill(password)
  await page.getByLabel('이름').fill(id)
  await page.getByLabel('비밀번호 확인').fill(password)
  await page.getByRole('button', { name: '회원가입' }).click()
  await expect(page).toHaveURL(/\/$/)
}
async function createTask(page: Page) {
  const assistants = await (await page.request.get('/api/assistants')).json() as Array<{ id: string }>
  return (await (await page.request.post('/api/tasks', { data: { assistantId: assistants[0]!.id } })).json()) as { id: string; threadId: string }
}

// E2E 요청 한도 64 KiB(playwright.config) → warn 은 80% = 52,429 B 초과, over 는 65,536 B 초과
test('U6 도우미 말풍선 — 한도 경고는 레벨이 오를 때 한 번만, hover 중에는 머물고, 클릭하면 자료 트레이를 펼친다', async ({ page }) => {
  await signup(page)
  const task = await createTask(page)
  await page.goto(`/c/${task.id}`)
  const composer = page.getByRole('textbox', { name: 'AI 요청 입력' })
  const region = page.getByRole('status', { name: 'AI 도우미 말풍선' })
  const bubble = page.getByTestId('assistant-bubble')
  const trayToggle = page.getByRole('button', { name: /^이번 요청에 사용 · / })
  await expect(trayToggle).toBeVisible()
  await expect(region).toHaveAttribute('aria-live', 'polite')
  await expect(bubble).toHaveCount(0)

  await composer.fill('x'.repeat(55_000)) // warn
  await expect(bubble).toContainText('한도의 80%')
  const pill = page.getByRole('button', { name: 'AI 도우미 열기' })
  const [pillBox, bubbleBox] = [await pill.boundingBox(), await bubble.boundingBox()]
  expect(bubbleBox!.x).toBeGreaterThan(pillBox!.x + pillBox!.width) // 알약 옆
  await page.getByRole('button', { name: '말풍선 닫기' }).click()
  await expect(bubble).toHaveCount(0)
  await composer.fill('x'.repeat(60_000)) // 여전히 warn — 같은 레벨은 다시 알리지 않는다
  await expect(page.getByRole('meter', { name: '요청 크기' })).toHaveAttribute('aria-valuenow', /\d/)
  await page.waitForTimeout(1_500) // 디바운스 400 ms + 추정 왕복 뒤에도 없음
  await expect(bubble).toHaveCount(0)

  await trayToggle.click() // 접어 둔다 — 말풍선 클릭이 펼치는지 보려고
  await expect(trayToggle).toHaveAttribute('aria-expanded', 'false')
  await composer.fill('x'.repeat(70_000)) // over — 레벨 상승이므로 한 번 더
  await expect(bubble).toContainText('한도를 넘어')
  await bubble.hover()
  await page.waitForTimeout(9_000) // 8초 소멸 시간을 넘겨도 hover 중에는 남아 있다
  await expect(bubble).toBeVisible()
  await bubble.getByRole('button', { name: /한도를 넘어/ }).click()
  await expect(bubble).toHaveCount(0)
  await expect(trayToggle).toHaveAttribute('aria-expanded', 'true')
  await expect(trayToggle).toBeFocused()
  await expect(page.getByRole('alert').filter({ hasText: '요청 크기 한도' })).toBeVisible()
})
