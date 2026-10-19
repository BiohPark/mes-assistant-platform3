import { expect, test } from '@playwright/test'
import { linkedMaterialsToggle } from './materials.js'

// S15 R3 잔여 — 헤더 #태그 칩 메뉴 [이 태그로 새 대화]: 같은 에이전트의 새 대화 초안에 그 태그 문자열만 프리셋한다.
// 파일·이전 대화는 자동으로 담지 않고, 첫 전송으로 생긴 대화의 자료 패널에 후보로만 보인다.
test('#태그 칩 → [이 태그로 새 대화] → 첫 전송 때 태그가 붙고 같은 태그 파일·대화가 후보로만 보인다', async ({ page }) => {
  await page.goto('/signup')
  await page.getByLabel('ID').fill(`preset-${Date.now()}`.slice(0, 32))
  await page.getByLabel('비밀번호', { exact: true }).fill('e2e-password-1234')
  await page.getByLabel('비밀번호 확인').fill('e2e-password-1234')
  await page.getByLabel('이름').fill('태그 프리셋')
  await page.getByRole('button', { name: '회원가입' }).click()
  await expect(page).toHaveURL(/\/$/)
  const assistants = await (await page.request.get('/api/assistants')).json() as Array<{ id: string; status: string }>
  const assistant = assistants.find(item => item.status === 'open')
  test.skip(!assistant, '활성 에이전트가 없어 대화를 만들 수 없습니다')
  const marker = `P${Date.now().toString(36)}`
  const tag = `preset-${marker}`
  const created = await page.request.post('/api/tasks', { data: { assistantId: assistant!.id, title: '태그 원본', tags: [tag] } })
  expect(created.ok()).toBe(true)
  const source = await created.json() as { id: string; code: string }
  const uploaded = await page.request.post('/api/files', { multipart: { originTaskId: source.id, file: { name: `note-${marker}.txt`, mimeType: 'text/plain', buffer: Buffer.from(marker) } } })
  expect(uploaded.ok()).toBe(true)

  await page.goto(`/c/${source.id}`)
  const active = page.locator('[data-tab-panel]:not([inert])')
  const chip = active.getByRole('button', { name: tag, exact: true })
  await expect(chip).toHaveAttribute('aria-haspopup', 'menu')
  await chip.click()
  await expect(page.getByRole('menu', { name: `#${tag} 태그 메뉴` })).toBeVisible()
  await page.getByRole('menuitem', { name: '이 태그로 새 대화' }).click()

  // 초안: 같은 에이전트, 태그만 프리셋 — 첨부 칩은 비어 있다
  await expect(page).toHaveURL(new RegExp(`/new/${encodeURIComponent(assistant!.id)}\\?tag=${encodeURIComponent(tag)}$`))
  const draft = page.getByRole('tabpanel', { name: /^새 대화 · / }) // 숨은 원본 대화 탭의 입력창과 구분
  await expect(draft.getByRole('button', { name: `${tag} 태그 제거`, exact: true })).toBeVisible()
  await expect(draft.getByRole('list', { name: '첨부', exact: true })).toHaveCount(0)
  await draft.getByRole('textbox', { name: 'AI 요청 입력' }).fill(`프리셋 질문 ${marker}`)
  await draft.getByRole('button', { name: '전송', exact: true }).click()

  // 첫 전송 때 대화가 생기고 그 태그가 붙는다
  await expect(page).toHaveURL(/\/c\/[^/]+$/)
  const taskId = new URL(page.url()).pathname.split('/')[2]!
  expect(taskId).not.toBe(source.id)
  const task = await (await page.request.get(`/api/tasks/${taskId}`)).json() as { assistantId: string; tags: string[]; inputs: unknown[] }
  expect(task.assistantId).toBe(assistant!.id)
  expect(task.tags).toEqual([tag])
  expect(await (await page.request.get(`/api/tasks/${taskId}/conversation-inputs`)).json()).toEqual([])

  // 우측 자료 패널: 같은 태그 대화의 파일·대화가 후보로 보인다(담기는 사람이)
  // 보이는 탭(숨은 탭은 aria-hidden)만 — 원본 대화 탭에도 같은 자료 패널이 있다
  const current = page.getByRole('tabpanel')
  const toggle = linkedMaterialsToggle(current)
  await expect(toggle).toHaveAttribute('aria-expanded', 'true') // 태그가 있으면 자료 패널이 열린 채로 시작
  await expect(current.getByTestId('materials-shared')).toContainText(`note-${marker}.txt`)
  await expect(current.getByTestId(`conversation-${source.id}`)).toBeVisible()
  await expect(current.getByRole('list', { name: '첨부', exact: true })).toHaveCount(0)
})

test('같은 에이전트의 초안 탭이 이미 열려 있어도 [이 태그로 새 대화]는 그 탭을 재사용하며 태그를 그 태그로 바꾼다', async ({ page }) => {
  await page.goto('/signup')
  await page.getByLabel('ID').fill(`preset2-${Date.now()}`.slice(0, 32))
  await page.getByLabel('비밀번호', { exact: true }).fill('e2e-password-1234')
  await page.getByLabel('비밀번호 확인').fill('e2e-password-1234')
  await page.getByLabel('이름').fill('태그 프리셋')
  await page.getByRole('button', { name: '회원가입' }).click()
  await expect(page).toHaveURL(/\/$/)
  const assistants = await (await page.request.get('/api/assistants')).json() as Array<{ id: string; name: string; status: string }>
  const assistant = assistants.find(item => item.status === 'open')
  test.skip(!assistant, '활성 에이전트가 없어 대화를 만들 수 없습니다')
  const tag = `preset-${Date.now().toString(36)}`
  const created = await page.request.post('/api/tasks', { data: { assistantId: assistant!.id, title: '태그 원본', tags: [tag] } })
  expect(created.ok()).toBe(true)
  const source = await created.json() as { id: string; code: string }
  const strip = page.getByRole('tablist', { name: '열린 화면' })

  // 원본 대화 탭을 연 뒤, 앱 안 이동(새로고침 없이)으로 같은 에이전트의 초안 탭을 열어 손으로 태그를 붙여 둔다
  await page.goto(`/c/${source.id}`)
  await page.getByRole('tabpanel').getByRole('link', { name: assistant!.name }).click() // 헤더 에이전트 칩 → 홈 탭 칸반
  await page.getByRole('link', { name: `${assistant!.name} 새 대화`, exact: true }).click() // 칸반 열 [+]
  await expect(page).toHaveURL(new RegExp(`/new/${encodeURIComponent(assistant!.id)}$`))
  const draft = page.getByRole('tabpanel', { name: /^새 대화 · / })
  const tagInput = draft.getByRole('combobox', { name: '태그 입력' })
  await tagInput.fill('먼저-붙인-태그')
  await tagInput.press('Enter')
  await expect(draft.getByRole('button', { name: '먼저-붙인-태그 태그 제거', exact: true })).toBeVisible()
  await draft.getByRole('textbox', { name: 'AI 요청 입력' }).fill('입력 중인 질문')
  const tabCount = await strip.getByRole('tab').count()

  // 원본 대화 탭으로 돌아가 칩 메뉴 → 초안 탭이 재사용되고 태그가 프리셋 태그로 바뀐다
  await strip.getByRole('tab', { name: `${source.code} · 태그 원본`, exact: true }).click()
  await page.getByRole('tabpanel').getByRole('button', { name: tag, exact: true }).click()
  await page.getByRole('menuitem', { name: '이 태그로 새 대화' }).click()
  await expect(page).toHaveURL(new RegExp(`/new/${encodeURIComponent(assistant!.id)}\\?tag=${encodeURIComponent(tag)}$`))
  await expect(strip.getByRole('tab')).toHaveCount(tabCount)
  await expect(draft.getByRole('button', { name: `${tag} 태그 제거`, exact: true })).toBeVisible()
  await expect(draft.getByRole('button', { name: '먼저-붙인-태그 태그 제거', exact: true })).toHaveCount(0)
  await expect(draft.getByRole('textbox', { name: 'AI 요청 입력' })).toHaveValue('입력 중인 질문')

  // 탭 칩으로 오가도(같은 주소) 사람이 고친 태그는 그대로
  await draft.getByRole('combobox', { name: '태그 입력' }).fill('추가-태그')
  await draft.getByRole('combobox', { name: '태그 입력' }).press('Enter')
  await strip.getByRole('tab', { name: `${source.code} · 태그 원본`, exact: true }).click()
  await strip.getByRole('tab', { name: /^새 대화 · / }).click()
  await expect(draft.getByRole('button', { name: '추가-태그 태그 제거', exact: true })).toBeVisible()
  await expect(draft.getByRole('button', { name: `${tag} 태그 제거`, exact: true })).toBeVisible()
})
