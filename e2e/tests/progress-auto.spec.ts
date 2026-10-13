import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'

async function setup(page: Page) {
  await page.goto('/signup')
  await page.getByLabel('ID').fill(`progress-${randomUUID().slice(0, 18)}`)
  await page.getByLabel('비밀번호', { exact: true }).fill('e2e-password-1234')
  await page.getByLabel('이름').fill('진행 상태 사용자')
  await page.getByLabel('비밀번호 확인').fill('e2e-password-1234')
  await page.getByRole('button', { name: '회원가입' }).click()
  await expect(page).toHaveURL(/\/$/)
  const assistants = await (await page.request.get('/api/assistants')).json() as Array<{ id: string; status: string }>
  const response = await page.request.post('/api/tasks', { data: { assistantId: assistants.find(item => item.status === 'open')!.id, title: '진행 상태 검증' } })
  expect(response.ok()).toBe(true)
  return await response.json() as { id: string; code: string; status: string }
}

for (const discussion of [false, true]) {
  test(`보류 중 ${discussion ? '팀 의견' : 'AI 요청'} 전송 → 자동 진행·기록·한 번에 보류`, async ({ page }) => {
    const task = await setup(page)
    expect((await page.request.post(`/api/tasks/${task.id}/status`, { data: { status: 'on_hold' } })).ok()).toBe(true)
    await page.goto(`/c/${task.id}`)
    if (discussion) await page.getByRole('button', { name: '팀 의견 (AI 미전송)' }).click()
    await page.getByRole('textbox', { name: discussion ? '팀 의견 입력' : 'AI 요청 입력' }).fill('보류 해제 확인')
    await page.getByRole('button', { name: '전송', exact: true }).click()
    const toast = page.locator('[data-sonner-toast]').filter({ hasText: '보류를 해제했습니다' })
    await expect(toast).toBeVisible()
    await expect(page.getByRole('button', { name: '보류', exact: true })).toHaveCount(2)
    const activity = await (await page.request.get(`/api/tasks/${task.id}/activity`)).json() as Array<{ type: string; payload: Record<string, unknown> }>
    expect(activity.filter(item => item.type === 'task.started' && item.payload.auto === true)).toHaveLength(1)
    await toast.getByRole('button', { name: '보류', exact: true }).click()
    await expect(page.getByRole('button', { name: '재개', exact: true })).toBeVisible()
    expect((await (await page.request.get(`/api/tasks/${task.id}`)).json()).status).toBe('on_hold')
  })

  test(`완료 뒤 ${discussion ? '팀 의견' : 'AI 요청'} → 취소 시 초안 유지·사유 재개 뒤 전송`, async ({ page }) => {
    const task = await setup(page)
    expect((await page.request.post(`/api/tasks/${task.id}/status`, { data: { status: 'done', reason: 'E2E 완료' } })).ok()).toBe(true)
    await page.goto(`/c/${task.id}`)
    if (discussion) await page.getByRole('button', { name: '팀 의견 (AI 미전송)' }).click()
    const input = page.getByRole('textbox', { name: discussion ? '팀 의견 입력' : 'AI 요청 입력' })
    await input.fill('재개 뒤에도 같은 내용')
    await page.getByRole('button', { name: '전송', exact: true }).click()
    let dialog = page.getByRole('dialog', { name: '재개할까요?' })
    await expect(dialog).toBeVisible()
    expect((await (await page.request.get(`/api/tasks/${task.id}`)).json()).status).toBe('done')
    await dialog.getByRole('button', { name: '취소' }).click()
    await expect(input).toHaveValue('재개 뒤에도 같은 내용')
    await page.getByRole('button', { name: '전송', exact: true }).click()
    dialog = page.getByRole('dialog', { name: '재개할까요?' })
    await dialog.getByPlaceholder('사유를 입력하세요').fill('추가 검토')
    await dialog.getByRole('button', { name: '재개 확인' }).click()
    await expect(page.getByText('재개 뒤에도 같은 내용', { exact: true }).first()).toBeVisible()
    await expect.poll(async () => (await (await page.request.get(`/api/tasks/${task.id}`)).json()).status).toBe('in_progress')
    const activity = await (await page.request.get(`/api/tasks/${task.id}/activity`)).json() as Array<{ type: string; payload: Record<string, unknown> }>
    expect(activity.find(item => item.type === 'task.reopened')?.payload.reason).toBe('추가 검토')
  })
}

test('7일 초과 무활동은 칸반·내 작업에 정체 표시만 추가한다', async ({ page }) => {
  const task = await setup(page)
  // 시간만 fixture로 바꾼다. 서버 상태가 변하지 않는지는 실제 API로 확인한다.
  await page.route('**/api/tasks', async route => {
    if (route.request().method() !== 'GET') return route.continue()
    const response = await route.fetch()
    const tasks = await response.json() as Array<{ id: string; lastActivityAt: string }>
    await route.fulfill({ response, json: tasks.map(item => item.id === task.id ? { ...item, lastActivityAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString() } : item) })
  })
  await page.goto('/?view=kanban')
  const card = page.getByRole('link', { name: new RegExp(task.code) }).locator('..')
  await expect(card.getByText('정체', { exact: true })).toBeVisible()
  await page.goto('/my-work')
  await expect(page.getByRole('link', { name: new RegExp(task.code) }).getByText('정체', { exact: true })).toBeVisible()
  expect((await (await page.request.get(`/api/tasks/${task.id}`)).json()).status).toBe('in_progress')
})
