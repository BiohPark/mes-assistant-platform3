import { expect, test, type Page } from '@playwright/test'

const password = 'e2e-password-1234'
async function owner(page: Page) {
  const signup = await page.request.post('/api/auth/signup', { data: { loginId: 'dev-owner', password } })
  if (signup.status() === 409) await page.request.post('/api/auth/login', { data: { loginId: 'dev-owner', password } }).then((response) => expect(response.ok()).toBe(true))
  else expect(signup.ok()).toBe(true)
  expect((await (await page.request.get('/api/me')).json()).roles).toContain('system_owner')
}

test('SO 연결 진단: 배지 링크 → AI 연결 카드 → 연결 시험 2줄 → 시험 대화 응답, 비SO·형식 오류는 거부', async ({ page, request }) => {
  await owner(page)
  await page.goto('/')
  await page.getByRole('link', { name: '연결 진단 열기' }).click()
  await expect(page).toHaveURL(/\/admin\/diagnostics$/)

  const card = page.getByRole('region', { name: 'AI 연결' })
  await expect(card.getByRole('term').filter({ hasText: /^모드$/ }).locator('xpath=following-sibling::dd[1]')).toHaveText(/^(Mock|Live)$/) // dd의 aria-label은 접근성 이름으로 노출되지 않는다
  await expect(card.getByRole('term').filter({ hasText: /^API 키$/ }).locator('xpath=following-sibling::dd[1]')).toHaveText(/^(설정됨|없음)$/)
  await expect(card.getByText(/LLM_BASE_URL/)).not.toContainText('http')
  const connection = page.waitForResponse((response) => response.url().endsWith('/api/admin/llm/test-connection'))
  await card.getByRole('button', { name: '연결 시험' }).click()
  const connected = await connection
  expect(connected.status()).toBe(200)
  expect(JSON.stringify(await connected.json())).not.toMatch(/e2e-fake-key|Authorization|Bearer|127\.0\.0\.1/)
  const result = card.getByRole('status')
  await expect(result).toContainText('모델 목록: 성공')
  await expect(result).toContainText('응답: 성공')

  const chat = page.getByRole('region', { name: '시험 대화' })
  const select = chat.getByRole('combobox', { name: '모델 선택' })
  await select.click()
  const option = page.getByRole('option').first()
  await expect(option).toBeVisible()
  await option.click()
  const model = await select.inputValue()
  expect(model).not.toBe('')
  await chat.getByRole('textbox', { name: '시험 메시지' }).fill('E2E 시험 메시지')
  const tested = page.waitForResponse((response) => response.url().endsWith('/api/admin/llm/test') && response.request().method() === 'POST')
  await chat.getByRole('button', { name: '전송' }).click()
  const reply = await tested
  expect(reply.status()).toBe(200)
  expect(reply.request().postDataJSON()).toEqual({ model, messages: [{ role: 'user', content: 'E2E 시험 메시지' }] })
  expect(Object.keys(await reply.json()).sort()).toEqual(['model', 'ms', 'text'])
  const transcript = chat.getByRole('list', { name: '시험 대화 이력' })
  await expect(transcript.getByRole('listitem')).toHaveCount(2)
  await expect(transcript.getByRole('listitem').first()).toContainText('E2E 시험 메시지') // mock·가짜 OWUI 응답도 보낸 글을 되풀이하므로 getByText는 2개에 걸린다
  await expect(transcript.getByRole('listitem').nth(1)).toContainText(`${model} · `)
  await expect(chat.getByRole('textbox', { name: '시험 메시지' })).toHaveValue('')

  expect((await page.request.post('/api/admin/llm/test', { data: { messages: [{ role: 'assistant', content: 'x' }] } })).status()).toBe(400)
  // 메시지당 32 768자 한도(400)는 피하고 합계로 요청 한도(e2e 65 536 바이트)를 넘긴다
  const long = 'x'.repeat(30_000)
  expect((await page.request.post('/api/admin/llm/test', { data: { messages: [{ role: 'user', content: long }, { role: 'assistant', content: long }, { role: 'user', content: long }] } })).status()).toBe(413)

  const loginId = `e2e-llm-${Date.now().toString(36)}`
  expect((await request.post('/api/auth/signup', { data: { loginId, password } })).ok()).toBe(true)
  expect((await request.post('/api/admin/llm/test', { data: { messages: [{ role: 'user', content: 'x' }] } })).status()).toBe(403)
  expect((await request.post('/api/admin/llm/test-connection', { data: {} })).status()).toBe(403)
  expect((await request.get('/api/llm/models')).ok()).toBe(true)
})

test('SO 전역 기본 모델: 저장·해제 즉시 반영, 목록 실패 시 기존 값 유지, 비SO·구형 키 거부', async ({ page, request }) => {
  await owner(page)
  const original = await (await page.request.get('/api/settings')).json()
  try {
    await page.goto('/settings')
    const picker = page.getByRole('combobox', { name: '기본 모델' })
    await expect(picker).toBeEnabled()
    const model = (await (await page.request.get('/api/llm/models')).json()).models[0] as string | undefined
    expect(model).toBeTruthy()
    await picker.click()
    await page.getByRole('option', { name: model!, exact: true }).click()
    const saved = page.waitForResponse(response => response.url().endsWith('/api/settings') && response.request().method() === 'PATCH')
    await page.getByRole('button', { name: '설정 저장' }).click()
    const written = await saved
    expect(written.status()).toBe(200)
    expect(written.request().postDataJSON()).toMatchObject({ defaultModelOverride: model })
    expect(written.request().postDataJSON()).not.toHaveProperty('defaultModel')
    await expect(page.getByText(`현재 적용 모델: ${model}`, { exact: true })).toBeVisible()
    await expect(page.getByText('출처: 전역 설정', { exact: true })).toBeVisible()

    async function assertConsumers(expected: string) {
      expect((await (await page.request.get('/api/system-assistant/model')).json()).model).toBe(expected)
      expect((await (await page.request.get('/api/admin/diagnostics')).json()).llm.defaultModel).toBe(expected)
      const tested = await page.request.post('/api/admin/llm/test', { data: { messages: [{ role: 'user', content: '전역 모델 확인' }] } })
      expect(tested.status()).toBe(200)
      expect((await tested.json()).model).toBe(expected)
      const connected = await page.request.post('/api/admin/llm/test-connection', { data: {} })
      expect(connected.status()).toBe(200)
      expect((await connected.json()).completion.model).toBe(expected)
    }
    await assertConsumers(model!)

    await page.route('**/api/llm/models', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }))
    await page.reload()
    await expect(page.getByRole('alert')).toContainText('모델 목록을 불러오지 못했습니다.')
    await expect(picker).toHaveValue(model!)
    await expect(page.getByText(`현재 적용 모델: ${model}`, { exact: true })).toBeVisible()
    await page.unroute('**/api/llm/models')
    await page.getByRole('button', { name: '다시 시도' }).click()
    await expect(picker).toBeEnabled()

    await page.getByRole('button', { name: '설정 해제(.env 값 사용)' }).click()
    const cleared = page.waitForResponse(response => response.url().endsWith('/api/settings') && response.request().method() === 'PATCH')
    await page.getByRole('button', { name: '설정 저장' }).click()
    const fallbackResponse = await cleared
    expect(fallbackResponse.status()).toBe(200)
    expect(fallbackResponse.request().postDataJSON().defaultModelOverride).toBeNull()
    const fallback = await fallbackResponse.json()
    expect(['env', 'default']).toContain(fallback.defaultModelSource)
    await expect(page.getByText(`현재 적용 모델: ${fallback.defaultModel}`, { exact: true })).toBeVisible()
    await assertConsumers(fallback.defaultModel)

    expect((await page.request.patch('/api/settings', { data: { defaultModel: 'legacy', defaultModelOverride: 'new' } })).status()).toBe(400)
    expect((await page.request.patch('/api/settings', { data: { defaultModelOverride: 'x'.repeat(192) } })).status()).toBe(400)
    const loginId = `e2e-default-model-${Date.now().toString(36)}`
    expect((await request.post('/api/auth/signup', { data: { loginId, password } })).ok()).toBe(true)
    expect((await request.get('/api/settings')).status()).toBe(200)
    for (const value of [model, null]) expect((await request.patch('/api/settings', { data: { defaultModelOverride: value } })).status()).toBe(403)
  } finally {
    expect((await page.request.patch('/api/settings', { data: { defaultModelOverride: original.defaultModelOverride ?? null } })).status()).toBe(200)
  }
})
