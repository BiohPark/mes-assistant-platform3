import { expect, test } from '@playwright/test'

test.skip(process.env.LLM_MODE !== 'live', '가짜 OpenWebUI live 환경에서 실행')

test('S5 파일 처리 완료 뒤 첨부하여 답변한다', async ({ page }) => {
  await page.goto('/signup')
  await page.getByLabel('ID').fill(`e2e-live-success-${Date.now()}`)
  await page.getByLabel('비밀번호', { exact: true }).fill('e2e-password-1234')
  await page.getByLabel('비밀번호 확인').fill('e2e-password-1234')
  await page.getByRole('button', { name: '회원가입' }).click()
  const assistants = await (await page.request.get('/api/assistants')).json() as Array<{ id: string }>
  const task = await (await page.request.post('/api/tasks', { data: { assistantId: assistants[0]!.id } })).json() as { id: string }
  await page.goto(`/c/${task.id}`)
  await page.getByRole('button', { name: '팀 의견 (AI 미전송)' }).click()
  await page.locator('input[type="file"]').setInputFiles({ name: 'good-e2e.txt', mimeType: 'text/plain', buffer: Buffer.from('input') })
  await page.getByRole('textbox', { name: '팀 의견 입력' }).fill('첨부 확인')
  await page.getByRole('button', { name: '전송', exact: true }).click()
  await expect(page.getByText(/files: 1/).first()).toBeVisible()
  await page.getByRole('button', { name: '사용한 자료' }).click()
  await expect(page.getByRole('dialog')).toContainText('good-e2e.txt v1')
})

test('E2 파일 전달 실패 후 텍스트로 보내기를 선택해 복구한다', async ({ page }) => {
  await page.goto('/signup')
  await page.getByLabel('ID').fill(`e2e-live-${Date.now()}`)
  await page.getByLabel('비밀번호', { exact: true }).fill('e2e-password-1234')
  await page.getByLabel('비밀번호 확인').fill('e2e-password-1234')
  await page.getByRole('button', { name: '회원가입' }).click()
  const assistants = await (await page.request.get('/api/assistants')).json() as Array<{ id: string }>
  const task = await (await page.request.post('/api/tasks', { data: { assistantId: assistants[0]!.id } })).json() as { id: string }
  await page.goto(`/c/${task.id}`)
  await page.getByRole('button', { name: '팀 의견 (AI 미전송)' }).click()
  await page.locator('input[type="file"]').setInputFiles({ name: 'fail-e2e.txt', mimeType: 'text/plain', buffer: Buffer.from('inline retry') })
  await page.getByRole('textbox', { name: '팀 의견 입력' }).fill('파일을 확인해 줘')
  await page.getByRole('button', { name: '전송', exact: true }).click()
  await expect(page.getByText(/OpenWebUI에 전달하지 못해/).first()).toBeVisible()
  await page.getByRole('button', { name: '텍스트로 보내기' }).click()
  await page.getByRole('dialog').getByRole('checkbox').check()
  await page.getByRole('dialog').getByRole('button', { name: '다시 시도' }).click()
  await expect(page.getByText(/files: 0/).first()).toBeVisible()
})
