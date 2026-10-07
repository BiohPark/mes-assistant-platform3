import { expect, test } from '@playwright/test'

test.skip((process.env.E2E_LLM_MODE ?? process.env.LLM_MODE) !== 'live', '가짜 OpenWebUI live 환경에서 실행')
const fakeRequests = async (page: import('@playwright/test').Page) => (await (await page.request.get(`http://127.0.0.1:${process.env.E2E_FAKE_OWUI_PORT ?? '3102'}/__e2e/requests`)).json()) as Array<{ messages: Array<{ content: string }>; files?: Array<{ id: string }> }>

test('S5 파일 처리 완료 뒤 첨부하여 답변한다', async ({ page }) => {
  await page.goto('/signup')
  await page.getByLabel('ID').fill(`e2e-live-success-${Date.now()}`)
  await page.getByLabel('비밀번호', { exact: true }).fill('e2e-password-1234')
  await page.getByLabel('이름').fill('가상 사용자')
  await page.getByLabel('비밀번호 확인').fill('e2e-password-1234')
  await page.getByRole('button', { name: '회원가입' }).click()
  await expect(page).toHaveURL(/\/$/) // 세션 쿠키가 잡힌 뒤 API 호출
  const assistants = await (await page.request.get('/api/assistants')).json() as Array<{ id: string }>
  const task = await (await page.request.post('/api/tasks', { data: { assistantId: assistants[0]!.id } })).json() as { id: string }
  const main = await (await page.request.post('/api/files', { multipart: { originTaskId: task.id, file: { name: 'main-e2e.txt', mimeType: 'text/plain', buffer: Buffer.from('main') } } })).json() as { id: string }
  expect((await page.request.put(`/api/tasks/${task.id}/inputs/${main.id}`, { data: { weight: 'main' } })).ok()).toBe(true)
  await page.goto(`/c/${task.id}`)
  await page.locator('input[type="file"]').setInputFiles({ name: 'good-e2e.txt', mimeType: 'text/plain', buffer: Buffer.from('input') })
  await page.getByRole('textbox', { name: '팀 의견 입력' }).fill('첨부 확인')
  await page.getByRole('button', { name: '전송', exact: true }).click()
  await expect(page.getByText(/파일 처리 대기/).first()).toBeVisible()
  await expect(page.getByText(/files: 2/).first()).toBeVisible({ timeout: 15_000 }) // 가짜 서버의 느린 처리 + 병렬 부하
  await page.getByRole('button', { name: '사용한 자료' }).click()
  await expect(page.getByRole('dialog')).toContainText(/good-e2e\.txt.*v1.*파일 첨부/) // 라벨: '☑ good-e2e.txt · 이 대화 v1 · 파일 첨부'
  await expect(page.getByRole('dialog')).toContainText(/main-e2e\.txt.*v1/)
  const calls = await fakeRequests(page)
  const call = calls.findLast((entry) => !JSON.stringify(entry.messages[0] ?? '').includes('다음 대화의 제목') && JSON.stringify(entry.messages).includes('첨부 확인')) // 제목 보조 호출 제외
  expect(call?.messages.map((item) => item.content).join(' ')).toMatch(/main-e2e\.txt.*good-e2e\.txt/s)
  expect(call?.files).toHaveLength(2)
})

test('E2 파일 전달 실패 후 텍스트로 보내기를 선택해 복구한다', async ({ page }) => {
  await page.goto('/signup')
  await page.getByLabel('ID').fill(`e2e-live-${Date.now()}`)
  await page.getByLabel('비밀번호', { exact: true }).fill('e2e-password-1234')
  await page.getByLabel('이름').fill('가상 사용자')
  await page.getByLabel('비밀번호 확인').fill('e2e-password-1234')
  await page.getByRole('button', { name: '회원가입' }).click()
  await expect(page).toHaveURL(/\/$/) // 세션 쿠키가 잡힌 뒤 API 호출
  const assistants = await (await page.request.get('/api/assistants')).json() as Array<{ id: string }>
  const task = await (await page.request.post('/api/tasks', { data: { assistantId: assistants[0]!.id } })).json() as { id: string }
  await page.goto(`/c/${task.id}`)
  const beforeCalls = (await fakeRequests(page)).length
  await page.locator('input[type="file"]').setInputFiles({ name: 'fail-e2e.txt', mimeType: 'text/plain', buffer: Buffer.from('inline retry') })
  await page.getByRole('textbox', { name: '팀 의견 입력' }).fill('파일을 확인해 줘')
  await page.getByRole('button', { name: '전송', exact: true }).click()
  await expect(page.getByText(/OpenWebUI에 전달하지 못해/).first()).toBeVisible({ timeout: 15_000 })
  expect((await fakeRequests(page)).slice(beforeCalls).filter((entry) => JSON.stringify(entry.messages).includes('파일을 확인해 줘'))).toHaveLength(0)
  await page.getByRole('button', { name: '텍스트로 보내기' }).click()
  await page.getByRole('dialog').getByRole('checkbox').check()
  await page.getByRole('dialog').getByRole('button', { name: '다시 시도' }).click()
  await expect(page.getByText(/files: 0/).first()).toBeVisible({ timeout: 15_000 })
})
