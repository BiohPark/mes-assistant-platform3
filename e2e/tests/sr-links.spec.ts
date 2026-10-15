import { expect, test, type Page } from '@playwright/test'

// S14 SR 태그 연결·원클릭 이동·Ctrl+K SR 검색 — 시드에 기대지 않고 사용자·SR·업무를 직접 만든다
const password = 'e2e-password-1234'
async function signup(page: Page, suffix: string) {
  const id = `srl-${suffix}-${Date.now()}`.slice(0, 32)
  await page.goto('/signup')
  await page.getByLabel('ID').fill(id)
  await page.getByLabel('비밀번호', { exact: true }).fill(password)
  await page.getByLabel('이름').fill(id)
  await page.getByLabel('비밀번호 확인').fill(password)
  await page.getByRole('button', { name: '회원가입' }).click()
  await expect(page).toHaveURL(/\/$/)
  return id
}
async function activeAssistantId(page: Page) {
  const assistants = await (await page.request.get('/api/assistants')).json() as Array<{ id: string; status: string }>
  const active = assistants.find((item) => item.status === 'open')
  test.skip(!active, '활성 에이전트가 없어 대화를 만들 수 없습니다')
  return active!.id
}
/** 일반 담당자도 SR을 접수할 수 있다(D44) — 초안을 만들고 바로 접수한다 */
async function submitSr(page: Page, title: string) {
  const draft = await (await page.request.post('/api/service-requests')).json() as { id: string }
  const response = await page.request.post(`/api/service-requests/${draft.id}/submit`, { data: { title, body: 'S14 연결 확인', attachmentIds: [] } })
  expect(response.ok()).toBe(true)
  return (await response.json()) as { id: string; code: string }
}
async function createTask(page: Page, tags: string[]) {
  const response = await page.request.post('/api/tasks', { data: { assistantId: await activeAssistantId(page), tags } })
  expect(response.ok()).toBe(true)
  return (await response.json()) as { id: string; code: string }
}

test('SR 번호 태그를 단 업무: 헤더 SR 칩 → SR 처리 상세, 상세의 연결 업무 → 업무로 원클릭', async ({ page }) => {
  await signup(page, 'chip')
  const title = `태그 연결 ${Date.now()}`
  const sr = await submitSr(page, title)
  const task = await createTask(page, [sr.code])
  await page.goto(`/c/${task.id}`)
  await page.getByRole('button', { name: sr.code, exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/sr/manage\\?id=${sr.id}$`))
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByText(`${sr.code} ${title}`)).toBeVisible()
  await expect(sheet.getByRole('link', { name: new RegExp(task.code) })).toHaveAttribute('href', `/c/${task.id}`)
  // 처리 표의 연결 대화에도 태그 연결이 보인다 — 모달 Sheet가 열려 있으면 표는 접근성 트리에서 가려지므로 닫고 확인한다(닫으면 ?id=도 빠진다)
  await sheet.getByRole('button', { name: '닫기' }).click()
  await expect(page).toHaveURL(/\/sr\/manage$/)
  const linkedRow = page.getByRole('table').getByRole('row').filter({ hasText: sr.code })
  await expect(linkedRow.getByRole('link', { name: task.code })).toHaveAttribute('href', `/c/${task.id}`)
  // 상세의 연결 업무 → 업무로 원클릭
  await linkedRow.getByRole('button', { name: new RegExp(sr.code) }).click()
  await page.getByRole('dialog').getByRole('link', { name: new RegExp(task.code) }).click()
  await expect(page).toHaveURL(new RegExp(`/c/${task.id}$`))
})

test('Ctrl+K에서 SR 번호로 찾아 처리 상세를 연다', async ({ page }) => {
  await signup(page, 'search')
  const title = `검색 대상 ${Date.now()}`
  const sr = await submitSr(page, title)
  const task = await createTask(page, [])
  await page.goto(`/c/${task.id}`)
  await page.getByRole('button', { name: /빠른 전환/ }).waitFor()
  await page.keyboard.press('Control+k')
  const search = page.getByRole('textbox', { name: '대화·SR 검색' })
  await expect(search).toBeFocused()
  await search.fill(sr.code.toLowerCase())
  await page.getByRole('menuitem', { name: new RegExp(sr.code) }).click()
  await expect(page).toHaveURL(new RegExp(`/sr/manage\\?id=${sr.id}$`))
  await expect(page.getByRole('dialog').getByText(`${sr.code} ${title}`)).toBeVisible()
})

test('접수되지 않은 SR 번호 칩은 이동하지 않고 안내한다', async ({ page }) => {
  await signup(page, 'missing')
  const code = `SR-2099-${String(Date.now() % 10_000).padStart(4, '0')}`
  const task = await createTask(page, [code])
  await page.goto(`/c/${task.id}`)
  await page.getByRole('button', { name: code, exact: true }).click()
  await expect(page.getByText(`${code} SR을 찾을 수 없거나 볼 권한이 없습니다`)).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/c/${task.id}$`))
})
