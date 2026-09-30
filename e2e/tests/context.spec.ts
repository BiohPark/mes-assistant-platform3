import { expect, test, type Page } from '@playwright/test'

const password = 'e2e-password-1234'
async function setup(page: Page, suffix: string) {
  await page.goto('/signup')
  await page.getByLabel('ID').fill(`e2e-ctx-${suffix}-${Date.now()}`) // 로그인 ID는 32자 이하
  await page.getByLabel('비밀번호', { exact: true }).fill(password)
  await page.getByLabel('비밀번호 확인').fill(password)
  await page.getByRole('button', { name: '회원가입' }).click()
  await expect(page).toHaveURL(/\/$/)
  const assistants = await (await page.request.get('/api/assistants')).json() as Array<{ id: string }>
  const tag = `context-${suffix}-${Date.now()}`
  const create = async (tags: string[]) => (await (await page.request.post('/api/tasks', { data: { assistantId: assistants[0]!.id, tags } })).json()) as { id: string; code: string; threadId: string }
  const source = await create([tag])
  const consumer = await create([tag])
  const unrelated = await create([`other-${tag}`])
  return { source, consumer, unrelated }
}
async function request(page: Page, threadId: string, content: string) {
  const result = await page.request.post(`/api/threads/${threadId}/requests`, { headers: { 'Idempotency-Key': crypto.randomUUID() }, data: { content } })
  expect(result.status()).toBe(201)
  await expect.poll(async () => {
    const messages = await (await page.request.get(`/api/threads/${threadId}/messages`)).json() as Array<{ status: string }>
    return messages.at(-1)?.status
  }).toBe('done')
}
async function selectedInputs<T>(page: Page, taskId: string): Promise<T[]> {
  await expect.poll(async () => (await (await page.request.get(`/api/tasks/${taskId}/conversation-inputs`)).json() as unknown[]).length).toBe(1)
  return await (await page.request.get(`/api/tasks/${taskId}/conversation-inputs`)).json() as T[]
}
async function openMaterials(page: Page, taskId: string) {
  await page.goto(`/c/${taskId}`)
  await page.getByRole('tablist', { name: '보조 패널' }).getByRole('tab', { name: '자료' }).click()
  await page.getByTestId('materials-panel').getByRole('tab', { name: '대화', exact: true }).click()
}

test('E3a 직접 공유 후보와 전체 원문은 팀 의견을 제외한다', async ({ page }) => {
  const { source, consumer, unrelated } = await setup(page, 'full')
  await request(page, source.threadId, '원본 질문 E3a')
  await page.request.post(`/api/threads/${source.threadId}/messages`, { data: { content: '팀 내부 의견 E3a', kind: 'discussion' } })
  await openMaterials(page, consumer.id)
  await expect(page.getByTestId(`conversation-${source.id}`)).toBeVisible()
  await expect(page.getByTestId(`conversation-${unrelated.id}`)).toHaveCount(0)
  await page.getByTestId(`conversation-${source.id}`).getByLabel(`${source.code} 참고 입력으로 선택`).click() // 선택은 서버 저장 뒤에 반영된다 — check()의 즉시 상태 검사와 맞지 않는다
  await expect.poll(async () => (await (await page.request.get(`/api/tasks/${consumer.id}/conversation-inputs`)).json() as unknown[]).length).toBe(1)
  const selected = await (await page.request.get(`/api/tasks/${consumer.id}/conversation-inputs`)).json() as Array<{ snapshot: { messageIds: string[] } }>
  expect(selected[0]!.snapshot.messageIds).toHaveLength(2)
})

test('E3b 메시지 선택은 고른 범위만 스냅샷에 고정한다', async ({ page }) => {
  const { source, consumer } = await setup(page, 'messages')
  await request(page, source.threadId, '원본 질문 E3b')
  await openMaterials(page, consumer.id)
  await page.getByTestId(`conversation-${source.id}`).getByRole('button', { name: `${source.code} 세부 조절` }).click()
  await page.getByRole('tab', { name: '메시지 선택' }).click()
  await page.getByRole('button', { name: '해제' }).click()
  await page.getByLabel('1번째 메시지 선택').click()
  await page.getByRole('button', { name: '적용' }).click()
  const selected = await selectedInputs<{ snapshot: { messageIds: string[] }; messageCount: number }>(page, consumer.id)
  expect(selected[0]).toMatchObject({ messageCount: 1, snapshot: { messageIds: [expect.any(String)] } })
})

test('E3c 요약 초안을 명시적으로 만들고 수정본을 적용한다', async ({ page }) => {
  const { source, consumer } = await setup(page, 'summary')
  await request(page, source.threadId, '원본 질문 E3c')
  await openMaterials(page, consumer.id)
  await page.getByTestId(`conversation-${source.id}`).getByRole('button', { name: `${source.code} 세부 조절` }).click()
  await page.getByRole('tab', { name: '요약' }).click()
  await expect(page.getByRole('textbox', { name: '참조 대화 요약' })).toHaveValue('')
  await page.getByRole('button', { name: '요약 만들기' }).click()
  await expect(page.getByRole('textbox', { name: '참조 대화 요약' })).not.toHaveValue('')
  await page.getByRole('textbox', { name: '참조 대화 요약' }).fill('사람이 수정한 요약 E3c')
  await page.getByRole('button', { name: '적용' }).click()
  const selected = await selectedInputs<{ snapshot: { summaryText: string; mode: string } }>(page, consumer.id)
  expect(selected[0]!.snapshot).toMatchObject({ mode: 'summary', summaryText: '사람이 수정한 요약 E3c' })
})

test('E3d 선택 시점은 고정되고 새 메시지는 갱신 뒤 포함된다', async ({ page }) => {
  const { source, consumer } = await setup(page, 'refresh')
  await request(page, source.threadId, '원본 질문 E3d 첫째')
  await openMaterials(page, consumer.id)
  await page.getByTestId(`conversation-${source.id}`).getByLabel(`${source.code} 참고 입력으로 선택`).click() // 선택은 서버 저장 뒤에 반영된다 — check()의 즉시 상태 검사와 맞지 않는다
  const first = await selectedInputs<{ snapshot: { id: string; messageIds: string[] } }>(page, consumer.id)
  await request(page, source.threadId, '원본 질문 E3d 둘째')
  await page.reload()
  await page.getByRole('tablist', { name: '보조 패널' }).getByRole('tab', { name: '자료' }).click()
  await page.getByTestId('materials-panel').getByRole('tab', { name: '대화', exact: true }).click()
  await expect(page.getByTestId(`conversation-${source.id}`).getByText(/새 메시지 2 · 갱신/)).toBeVisible()
  const still = await (await page.request.get(`/api/tasks/${consumer.id}/conversation-inputs`)).json() as Array<{ snapshot: { id: string; messageIds: string[] } }>
  expect(still[0]!.snapshot.id).toBe(first[0]!.snapshot.id)
  await page.getByTestId(`conversation-${source.id}`).getByText(/새 메시지 2 · 갱신/).click()
  await expect.poll(async () => {
    const rows = await (await page.request.get(`/api/tasks/${consumer.id}/conversation-inputs`)).json() as Array<{ snapshot: { messageIds: string[] } }>
    return rows[0]?.snapshot.messageIds.length
  }).toBe(4)
})
