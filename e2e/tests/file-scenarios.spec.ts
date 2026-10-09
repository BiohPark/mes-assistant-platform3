import { expect, test, type Page } from '@playwright/test'

// S8 파일 시나리오 중 브라우저가 필요한 것 — 표: tasks/s8-file-scenarios/artifacts/file-scenarios.md (U-06·U-07·T-01·T-03)
const password = 'e2e-password-1234'

async function signUp(page: Page) {
  await page.goto('/signup')
  await page.getByLabel('ID').fill(`e2e-fscn-${Date.now()}`.slice(0, 32))
  await page.getByLabel('비밀번호', { exact: true }).fill(password)
  await page.getByLabel('이름').fill('가상 사용자')
  await page.getByLabel('비밀번호 확인').fill(password)
  await page.getByRole('button', { name: '회원가입' }).click()
  await expect(page).toHaveURL(/\/$/)
}
async function createTask(page: Page, body: Record<string, unknown> = {}) {
  const assistants = await (await page.request.get('/api/assistants')).json() as Array<{ id: string }>
  return (await (await page.request.post('/api/tasks', { data: { assistantId: assistants[0]!.id, ...body } })).json()) as { id: string; code: string; threadId: string }
}
async function openMaterials(page: Page) {
  await page.getByRole('tablist', { name: '보조 패널' }).getByRole('tab', { name: '자료' }).click()
}

test('U-06/U-07 한글·공백·이모지 파일 이름이 업로드·목록·내려받기 헤더에서 그대로 유지된다', async ({ page }) => {
  await signUp(page)
  const task = await createTask(page)
  await page.goto(`/c/${task.id}`)
  await openMaterials(page)
  await page.getByRole('tab', { name: '이 대화 파일' }).click()
  const names = ['알람_이력_0901.csv', '설비 점검표.txt', '메모 🙂.md']
  // 브라우저 경로: 자료 탭 업로드 (multipart 파일 이름은 UTF-8 원시 바이트로 간다)
  await page.getByTestId('materials-own').locator('input[type="file"]').setInputFiles(names.map((name) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(name) })))
  for (const name of names) await expect(page.getByTestId('materials-own')).toContainText(`${name} v1`)
  // API 경로: Playwright multipart
  await page.request.post('/api/files', { multipart: { originTaskId: task.id, file: { name: '점검 결과 ✔.txt', mimeType: 'text/plain', buffer: Buffer.from('api') } } })
  await expect(page.getByTestId('materials-own')).toContainText('점검 결과 ✔.txt v1')
  const files = await (await page.request.get(`/api/tasks/${task.id}/files`)).json() as Array<{ id: string; name: string }>
  expect(files.map((file) => file.name)).toEqual([...names, '점검 결과 ✔.txt'])
  // 내려받기: RFC 5987 filename* 에 UTF-8 이름, ASCII 대체 이름도 함께
  const download = await page.request.get(`/api/files/${files[1]!.id}/content`)
  expect(download.headers()['content-disposition']).toContain(`filename*=UTF-8''${encodeURIComponent('설비 점검표.txt')}`)
  expect(download.headers()['content-disposition']).toMatch(/filename="[\x20-\x7e]+"/)
  expect(await download.text()).toBe('설비 점검표.txt')
  // Windows 금지 문자는 거부된다
  const rejected = await page.request.post('/api/files', { multipart: { originTaskId: task.id, file: { name: 'a:b.txt', mimeType: 'text/plain', buffer: Buffer.from('x') } } })
  expect(rejected.status()).toBe(400)
})

test('T-01/T-03 공유 자료함은 출처를 대화 코드·제목으로 보여 주고, 태그를 나중에 붙여도 후보가 된다', async ({ page }) => {
  await signUp(page)
  const tag = `fscn-${Date.now()}`
  const source = await createTask(page, { tags: [tag], title: '알람 이력 분석' })
  await page.request.post('/api/files', { multipart: { originTaskId: source.id, file: { name: '알람_이력_0901.csv', mimeType: 'text/csv', buffer: Buffer.from('a,b') } } })
  const consumer = await createTask(page)
  await page.goto(`/c/${consumer.id}`)
  await openMaterials(page)
  await page.getByRole('tab', { name: '공유 자료함' }).click()
  await expect(page.getByTestId('materials-shared')).toContainText('같은 태그 대화의 파일이 없습니다.')
  // 공유 뒤 태그 추가 → 그때부터 후보
  await page.getByRole('combobox', { name: '태그 입력' }).fill(tag)
  await page.getByRole('combobox', { name: '태그 입력' }).press('Enter')
  await expect(page.getByTestId('materials-shared')).toContainText('알람_이력_0901.csv v1')
  const row = page.getByTestId('materials-shared').locator('[data-testid^="candidate-file-"]').first()
  await expect(row).toContainText(`업로드 · ${source.code} · 알람 이력 분석 · ${tag}`)
  await expect(row).not.toContainText(source.id) // 내부 ID는 화면에 보이지 않는다
  await expect(row.getByRole('link', { name: source.code })).toHaveAttribute('href', `/c/${source.id}`)
  await row.getByRole('checkbox', { name: '알람_이력_0901.csv 참고 입력으로 선택' }).click()
  await page.getByRole('tab', { name: 'AI 입력' }).click()
  await expect(page.getByTestId('materials-inputs')).toContainText(`참고 · ${source.code} · 알람 이력 분석`)
})
