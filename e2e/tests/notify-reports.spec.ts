import { expect, test } from '@playwright/test'

const password = 'e2e-password-1234'

test('대화 배정 알림이 두 컨텍스트의 벨에 즉시 표시되고 읽음·이동한다', async ({ browser }) => {
  const origin = process.env.APP_ORIGIN ?? 'http://localhost:5173'
  const ownerContext = await browser.newContext({ baseURL: origin })
  const firstContext = await browser.newContext({ baseURL: origin })
  const secondContext = await browser.newContext({ baseURL: origin })
  const owner = await ownerContext.newPage()
  const first = await firstContext.newPage()
  const second = await secondContext.newPage()
  const loginId = `ntf-${Date.now().toString(36)}`
  expect(loginId.length).toBeLessThanOrEqual(32)
  try {
    const signed = await first.request.post('/api/auth/signup', { data: { loginId, password } })
    expect(signed.ok()).toBe(true)
    const assigneeId = ((await signed.json()) as { id: string }).id
    expect((await second.request.post('/api/auth/login', { data: { loginId, password } })).ok()).toBe(true)
    const ownerSignup = await owner.request.post('/api/auth/signup', { data: { loginId: 'dev-owner', password } })
    if (ownerSignup.status() === 409) expect((await owner.request.post('/api/auth/login', { data: { loginId: 'dev-owner', password } })).ok()).toBe(true)
    else expect(ownerSignup.ok()).toBe(true)
    expect((await (await owner.request.get('/api/me')).json() as { roles: string[] }).roles).toContain('system_owner')
    await first.goto('/')
    await second.goto('/')
    await expect(first.getByRole('button', { name: '알림' })).toBeVisible()
    await expect(second.getByRole('button', { name: '알림' })).toBeVisible()
    const assistants = await (await owner.request.get('/api/assistants')).json() as Array<{ id: string }>
    await owner.goto(`/new/${assistants[0]!.id}`)
    await expect(owner.getByLabel('담당자', { exact: true })).toHaveCount(0)
    // 초안 배정 UI는 제거됨. 서버의 명시 배정 계약으로 알림을 검증한다.
    const created = await owner.request.post('/api/tasks', { data: { assistantId: assistants[0]!.id, assigneeIds: [assigneeId], firstMessage: '알림 E2E 대화' } })
    expect(created.status()).toBe(201)
    const task = (await created.json()) as { id: string; assigneeIds: string[] }
    expect(task.assigneeIds).toEqual([assigneeId])
    await owner.goto(`/c/${task.id}`)
    await expect(owner).toHaveURL(/\/c\/[^/]+$/, { timeout: 15_000 })
    await expect(first.getByRole('button', { name: '알림 1건 미읽음' })).toBeVisible({ timeout: 15_000 })
    await expect(second.getByRole('button', { name: '알림 1건 미읽음' })).toBeVisible({ timeout: 15_000 })
    await first.getByRole('button', { name: '알림 1건 미읽음' }).click()
    await first.getByRole('menuitem', { name: /새 대화 업무가 배정되었습니다/ }).click()
    await expect(first).toHaveURL(new RegExp(`/c/${task.id}$`))
    await expect(first.getByRole('button', { name: '알림', exact: true })).toBeVisible()
    await expect.poll(async () => ((await (await first.request.get('/api/notifications/unread-count')).json()) as { count: number }).count).toBe(0)
  } finally {
    await ownerContext.close()
    await firstContext.close()
    await secondContext.close()
  }
})

test('리포트 8개 섹션과 기간·단위 토글', async ({ page }) => {
  const loginId = `rpt-${Date.now().toString(36)}`
  expect(loginId.length).toBeLessThanOrEqual(32)
  const signed = await page.request.post('/api/auth/signup', { data: { loginId, password } })
  expect(signed.ok()).toBe(true)
  const myId = ((await signed.json()) as { id: string }).id
  const assistants = await (await page.request.get('/api/assistants')).json() as Array<{ id: string }>
  expect((await page.request.post('/api/tasks', { data: { assistantId: assistants[0]!.id, tags: ['리포트검증'] } })).ok()).toBe(true)
  await page.goto('/reports')
  for (const title of ['완료 추이', '에이전트별 평균 리드타임', '사용자별 활동', 'SR 상태 분포', '자료 흐름', '태그별 대화', '에이전트별 현황', 'assistant 피드백 다이제스트']) {
    await expect(page.getByRole('heading', { name: new RegExp(title) })).toBeVisible({ timeout: 15_000 })
  }
  // 태그 목록은 상위 12개만 보이므로 담당자 필터로 내 대화만 집계해 확인한다
  await page.getByLabel('담당자').selectOption(myId)
  await expect(page.getByText('리포트검증')).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '7일' }).click()
  await page.getByRole('button', { name: '일', exact: true }).click()
  await expect(page.getByRole('img', { name: '완료 업무' }).locator(':scope > div')).toHaveCount(7)
  await expect(page.getByRole('button', { name: '7일' })).toHaveAttribute('data-variant', 'default')
})
