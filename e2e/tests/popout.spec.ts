import { expect, test, type Page } from '@playwright/test'

const password = 'e2e-password-1234'
async function signup(page: Page) {
  const id = `popout-${Date.now()}`.slice(0, 32)
  await page.goto('/signup')
  await page.getByLabel('ID').fill(id)
  await page.getByLabel('비밀번호', { exact: true }).fill(password)
  await page.getByLabel('이름').fill(id)
  await page.getByLabel('비밀번호 확인').fill(password)
  await page.getByRole('button', { name: '회원가입' }).click()
  await expect(page).toHaveURL(/\/$/)
}
async function createTask(page: Page, title: string) {
  const assistants = await (await page.request.get('/api/assistants')).json() as Array<{ id: string }>
  return (await (await page.request.post('/api/tasks', { data: { assistantId: assistants[0]!.id, title } })).json()) as { id: string; threadId: string }
}
const popoutButton = (page: Page) => page.getByRole('button', { name: '새 창으로 띄우기' })
async function openPopout(page: Page) {
  const [popup] = await Promise.all([page.waitForEvent('popup'), popoutButton(page).click()])
  await popup.waitForLoadState()
  return popup
}

test('새 창으로 띄우기 — 팝업에는 사이드바·상단 내비·도우미가 없고 대화만 보이며 자료 패널은 탭으로 간다. 창은 여러 개, 막히면 같은 탭으로 가지 않고 토스트', async ({ page, context }) => {
  await signup(page)
  const task = await createTask(page, '팝업 대화')
  await page.goto(`/c/${task.id}`)
  const popup = await openPopout(page)
  await expect(popup).toHaveURL(new RegExp(`/c/${task.id}\\?popout=1$`))
  await expect(popup.getByRole('textbox', { name: 'AI 요청 입력' })).toBeVisible()
  await expect(popup.getByRole('heading', { level: 1 })).toContainText('팝업 대화')
  await expect(popup.getByRole('navigation')).toHaveCount(0) // 사이드바
  await expect(popup.getByRole('button', { name: /모드로 전환$/ })).toHaveCount(0) // 상단 바 내비
  await expect(popup.getByRole('button', { name: '알림' })).toHaveCount(0)
  await expect(popup.getByTestId('assistant-pill')).toHaveCount(0) // 도우미 알약
  await expect(popup.getByRole('status', { name: 'AI 도우미 가이드 제안' })).toHaveCount(0)
  await expect(popoutButton(popup)).toHaveCount(0) // 팝업 안에서 다시 띄우기 없음
  await expect(popup.getByRole('button', { name: '업무 완료' })).toBeVisible() // 대화 헤더는 남는다
  await popup.getByRole('tab', { name: '자료', exact: true }).click() // 작은 창 → 보조 패널은 탭
  await expect(popup.getByRole('tabpanel')).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/c/${task.id}$`)) // 본창은 그대로
  await expect(page.getByRole('navigation')).toBeVisible()

  const other = await createTask(page, '둘째 팝업')
  await page.goto(`/c/${other.id}`)
  const second = await openPopout(page)
  await expect(second).toHaveURL(new RegExp(`/c/${other.id}\\?popout=1$`))
  expect(context.pages()).toHaveLength(3) // 본창 + 팝업 2

  await page.evaluate(() => { window.open = () => null }) // 팝업 차단
  await popoutButton(page).click()
  await expect(page.getByText('팝업이 차단되어 새 창을 열지 못했어요')).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/c/${other.id}$`))
  expect(context.pages()).toHaveLength(3)
})

test('완료 알림 — 팝업에서 보낸 답이 끝나면 다른 화면에 있는 본창의 도우미가 제목·첫 문장과 [바로 가기]로 알린다. 팝업과 보고 있는 창에는 뜨지 않는다', async ({ page }) => {
  await signup(page)
  const task = await createTask(page, '알림 대화')
  await page.goto(`/c/${task.id}`)
  const popup = await openPopout(page)
  const composer = popup.getByRole('textbox', { name: 'AI 요청 입력' })
  await composer.fill('요구사항을 정리해 주세요')
  await page.goto('/') // 본창은 허브로 — 그 대화를 보고 있지 않다
  await popup.getByRole('button', { name: '전송' }).click()
  await expect(popup.getByRole('button', { name: '중지' })).toHaveCount(0, { timeout: 30_000 }) // 응답 끝

  const bubble = page.getByTestId('assistant-bubble')
  await expect(bubble).toContainText('"알림 대화" 답변이 끝났어요')
  const excerpt = await bubble.getByTestId('bubble-excerpt').textContent()
  expect(excerpt!.length).toBeGreaterThan(0)
  expect(excerpt!.length).toBeLessThanOrEqual(80)
  await expect(popup.getByTestId('assistant-bubble')).toHaveCount(0) // 팝업에는 없다
  await bubble.getByRole('button', { name: '바로 가기' }).click()
  await expect(page).toHaveURL(new RegExp(`/c/${task.id}$`))
  await expect(bubble).toHaveCount(0)
  await expect(page.getByText('요구사항을 정리해 주세요')).toBeVisible()
})
