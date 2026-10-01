import { expect, test, type Page } from '@playwright/test'

const password = 'e2e-password-1234'
async function signup(page: Page, suffix: string) {
  const id = `tray-${suffix}-${Date.now()}`.slice(0, 32)
  await page.goto('/signup')
  await page.getByLabel('ID').fill(id)
  await page.getByLabel('비밀번호', { exact: true }).fill(password)
  await page.getByLabel('비밀번호 확인').fill(password)
  await page.getByRole('button', { name: '회원가입' }).click()
  await expect(page).toHaveURL(/\/$/)
  return id
}
async function createTask(page: Page) {
  const assistants = await (await page.request.get('/api/assistants')).json() as Array<{ id: string }>
  return (await (await page.request.post('/api/tasks', { data: { assistantId: assistants[0]!.id } })).json()) as { id: string; threadId: string }
}

test('E4 추정 한도 초과는 전송을 막고 입력 조절 동작을 보여 준다', async ({ page }) => {
  await signup(page, 'limit')
  const task = await createTask(page)
  await page.goto(`/c/${task.id}`)
  await page.getByRole('textbox', { name: '팀 의견 입력' }).fill('x'.repeat(270_000))
  await expect(page.getByRole('alert').filter({ hasText: '요청 크기 한도' })).toBeVisible()
  await expect(page.getByRole('button', { name: '전송', exact: true })).toBeDisabled()
  await expect(page.getByRole('link', { name: '새 대화로 이어가기' })).toHaveAttribute('href', new RegExp(`/new/.+ref=${task.id}`))
})

test('E6 요청 기록에서 사용한 자료와 원본 JSON을 연다', async ({ page }) => {
  test.skip((process.env.E2E_LLM_MODE ?? process.env.LLM_MODE) === 'live', 'Mock 전용 기록 검사')
  await signup(page, 'info')
  const task = await createTask(page)
  await page.goto(`/c/${task.id}`)
  await page.locator('input[type="file"]').setInputFiles({ name: `tray-${Date.now()}.txt`, mimeType: 'text/plain', buffer: Buffer.from('자료') })
  await page.getByRole('textbox', { name: '팀 의견 입력' }).fill('자료로 답변해 줘')
  await page.getByRole('button', { name: '전송', exact: true }).click()
  await expect(page.getByRole('button', { name: '사용한 자료' })).toBeVisible()
  await expect(page.getByRole('button', { name: '중지' })).toBeHidden()
  await page.getByRole('button', { name: '사용한 자료' }).click()
  await expect(page.getByRole('dialog')).toContainText('tray-')
  await expect(page.getByRole('link', { name: '원본 JSON 다운로드' })).toHaveAttribute('href', /\/snapshot$/)
})

test('다른 사용자 화면에 팀 의견과 입력 중 상태가 실시간 표시된다', async ({ page, browser }) => {
  const firstName = await signup(page, 'first')
  const task = await createTask(page)
  const secondContext = await browser.newContext()
  const second = await secondContext.newPage()
  try {
    await signup(second, 'second')
    const eventsReady = second.waitForResponse((response) => response.url().endsWith('/api/events') && response.status() === 200)
    await second.goto(`/c/${task.id}`)
    await eventsReady
    await page.goto(`/c/${task.id}`)
    await expect(second.getByRole('textbox', { name: '팀 의견 입력' })).toBeVisible()
    await page.getByRole('button', { name: '팀 의견 (AI 미전송)' }).click()
    await page.getByRole('textbox', { name: '팀 의견 입력' }).fill('작성 중')
    await expect(second.getByText(`${firstName} 입력 중…`)).toBeVisible()
    await page.getByRole('textbox', { name: '팀 의견 입력' }).fill('다른 PC 의견')
    await page.getByRole('button', { name: '전송', exact: true }).click()
    await expect(second.getByText('다른 PC 의견')).toBeVisible()
  } finally { await secondContext.close() }
})
