import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'

type Conversation = { id: string; threadId: string }
async function setup(page: Page) {
  const user = `basics-${randomUUID().slice(0, 16)}`
  await page.goto('/signup')
  await page.getByLabel('ID').fill(user)
  await page.getByLabel('비밀번호', { exact: true }).fill('e2e-password-1234')
  await page.getByLabel('비밀번호 확인').fill('e2e-password-1234')
  await page.getByLabel('이름').fill(user)
  await page.getByRole('button', { name: '회원가입' }).click()
  await expect(page).toHaveURL(/\/$/)
  const assistants = await (await page.request.get('/api/assistants')).json() as Array<{ id: string }>
  expect(assistants.length).toBeGreaterThan(0)
  const tasks: Conversation[] = []
  for (const title of ['기본기 첫 대화', '기본기 둘째 대화']) {
    const response = await page.request.post('/api/tasks', { data: { assistantId: assistants[0]!.id, title } })
    expect(response.ok()).toBe(true)
    tasks.push(await response.json() as Conversation)
  }
  for (const [index, task] of tasks.entries()) {
    await page.route(`**/api/threads/${task.threadId}/messages`, route => route.fulfill({ json: Array.from({ length: 24 }, (_, number) => ({
      id: `${task.id}-${number}`, threadId: task.threadId, seq: number + 1, role: number % 2 ? 'assistant' : 'user',
      content: `${index ? '둘째' : '첫째'} 검색 본문 ${number}\n\n${'긴 본문 줄\n\n'.repeat(12)}`, status: 'done', attachmentIds: [], createdAt: `2026-10-01T00:00:${String(number).padStart(2, '0')}Z`,
    })) }))
  }
  return tasks as [Conversation, Conversation]
}

test('ActivityPanel groups one request into one row', async ({ page }) => {
  const [task] = await setup(page)
  await page.route(`**/api/tasks/${task.id}/activity`, route => route.fulfill({ json: [
    { id: 'completed', userId: 'u', type: 'request.completed', at: '2026-10-01T00:00:02Z', payload: { requestId: 'request-one' } },
    { id: 'started', userId: 'u', type: 'request.started', at: '2026-10-01T00:00:01Z', payload: { requestId: 'request-one' } },
    { id: 'sent', userId: 'u', type: 'message.sent', at: '2026-10-01T00:00:00Z', payload: { requestId: 'request-one' } },
  ] }))
  await page.goto(`/c/${task.id}`)
  await page.getByRole('tab', { name: '이력', exact: true }).click()
  const row = page.locator('[data-request-id="request-one"]:visible')
  await expect(row).toHaveCount(1)
  await expect(row.locator('details')).not.toHaveAttribute('open', '')
  await row.getByText('요청 상세 3건').click()
  await expect(row.getByText('AI 요청 시작', { exact: true })).toBeVisible()
})

test('search resets on task switch', async ({ page }) => {
  const [first, second] = await setup(page)
  await page.goto(`/c/${first.id}`)
  // 검색은 헤더의 🔍 아이콘을 눌러 펼친다
  await page.getByRole('button', { name: '대화 내 검색' }).click()
  const search = page.getByRole('searchbox', { name: '대화 내 검색' })
  await search.fill('첫째')
  await expect(page.getByRole('search').getByRole('status')).toHaveText('1/24')
  await page.getByRole('button', { name: '다음', exact: true }).click()
  await expect(page.getByRole('search').getByRole('status')).toHaveText('2/24')
  await page.keyboard.press('Control+k')
  await page.getByRole('menuitem').filter({ hasText: '기본기 둘째 대화' }).click()
  await expect(page).toHaveURL(new RegExp(`/c/${second.id}$`))
  await expect(search).toHaveCount(0) // 대화를 바꾸면 검색 줄이 닫힌다
  await page.getByRole('button', { name: '대화 내 검색' }).click()
  await expect(search).toHaveValue('')
  await expect(page.getByRole('search').getByRole('status')).toHaveCount(0)
})

test('ctrl+k ignores composing and preserves browser find', async ({ page }) => {
  const [task] = await setup(page)
  await page.goto(`/c/${task.id}`)
  await expect(page.getByRole('button', { name: /빠른 전환/ })).toBeVisible()
  const prevented = await page.evaluate(() => {
    const composing = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, isComposing: true, bubbles: true, cancelable: true })
    const find = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true })
    window.dispatchEvent(composing); window.dispatchEvent(find)
    return [composing.defaultPrevented, find.defaultPrevented]
  })
  expect(prevented).toEqual([false, false])
  await expect(page.getByRole('menu')).toHaveCount(0)
  const normalPrevented = await page.evaluate(() => {
    const event = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
  })
  expect(normalPrevented).toBe(true)
  await expect(page.getByRole('menu')).toBeVisible()
})

test('scrollToBottom hidden at bottom and shown more than 200px above it', async ({ page }) => {
  const [task] = await setup(page)
  await page.goto(`/c/${task.id}`)
  const scroll = page.getByTestId('chat-message-scroll')
  await expect(page.locator('[data-message-id]')).toHaveCount(24)
  await scroll.evaluate(element => { element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event('scroll')) })
  const jump = page.getByRole('button', { name: '맨 아래로', exact: true })
  await expect(jump).toHaveCount(0)
  await scroll.evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')) })
  await expect(jump).toBeVisible()
  await jump.click()
  await expect(jump).toHaveCount(0)
  await expect.poll(() => scroll.evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThanOrEqual(24)
})
