import { expect, test, type Page } from '@playwright/test'
import { linkedMaterialsToggle, openWorkTool, revealMaterials } from './materials.js'

async function setup(page: Page) {
  await page.goto('/signup')
  await page.getByLabel('ID').fill(`r3-${Date.now()}`)
  await page.getByLabel('비밀번호', { exact: true }).fill('e2e-password-1234')
  await page.getByLabel('비밀번호 확인').fill('e2e-password-1234')
  await page.getByLabel('이름').fill('R3 검증')
  await page.getByRole('button', { name: '회원가입' }).click()
  await expect(page).toHaveURL(/\/$/)
  const assistants = await (await page.request.get('/api/assistants')).json() as Array<{ id: string; status: string }>
  const assistant = assistants.find(item => item.status === 'open')!
  const create = async (tags: string[]) => {
    const response = await page.request.post('/api/tasks', { data: { assistantId: assistant.id, title: 'R3 화면', tags } })
    expect(response.ok()).toBe(true)
    return await response.json() as { id: string; threadId: string; code: string }
  }
  return { create }
}

test('자동 펼침 없이 수동 선택·새 태그·새로고침·MDI를 유지하고 자료를 자동 담지 않는다', async ({ page }) => {
  const { create } = await setup(page)
  const first = await create([])
  const second = await create(['R3'])
  await page.goto(`/c/${first.id}`)
  const active = page.locator('[data-tab-panel]:not([inert])')
  const firstTab = page.getByRole('tab', { name: `${first.code} · R3 화면`, exact: true })
  const secondTab = page.getByRole('tab', { name: `${second.code} · R3 화면`, exact: true })
  await expect(firstTab).toHaveAttribute('aria-selected', 'true')
  const toggle = linkedMaterialsToggle(active)
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('complementary', { name: '#태그·SR 연결 자료' })).toBeHidden()
  await expect(page.locator('[data-tour="related"]')).toHaveCount(0)
  await page.getByRole('button', { name: '태그 추가' }).click()
  const tag = page.getByRole('dialog', { name: '태그 추가' }).getByRole('combobox', { name: '태그 입력' })
  await tag.fill('R3')
  await tag.press('Enter')
  await expect(tag).toHaveAttribute('aria-busy', 'false')
  await expect(active.getByRole('button', { name: 'R3 태그 제거', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(tag).toBeHidden()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('list', { name: '첨부', exact: true })).toHaveCount(0)
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await page.reload()
  await expect(firstTab).toHaveAttribute('aria-selected', 'true')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await page.goto(`/c/${second.id}`)
  await expect(secondTab).toHaveAttribute('aria-selected', 'true')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await firstTab.click()
  await expect(firstTab).toHaveAttribute('aria-selected', 'true')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await page.getByRole('button', { name: '태그 추가' }).click()
  await tag.fill('R3-added')
  await tag.press('Enter')
  await expect(tag).toHaveAttribute('aria-busy', 'false')
  await expect(active.getByRole('button', { name: 'R3-added 태그 제거', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(tag).toBeHidden()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(active.getByRole('list', { name: '첨부', exact: true })).toHaveCount(0)
  await toggle.click()
  await openWorkTool(page, '메모')
  await expect(active.getByRole('tabpanel', { name: '메모', exact: true })).toBeVisible()
})

test('레일의 보조 도구·더 보기 관리·전송 기록과 두 파일 재시도 대화상자를 연다', async ({ page }) => {
  const { create } = await setup(page)
  const task = await create([])
  const reply = { id: 'reply-r3', threadId: task.threadId, seq: 1, role: 'assistant', content: '답변', status: 'done', requestId: 'request-r3', attachmentIds: [], createdAt: '2026-10-01T00:00:00Z' }
  await page.route(`**/api/threads/${task.threadId}/messages`, route => route.fulfill({ json: [reply] }))
  await page.route('**/api/requests/request-r3', route => route.fulfill({ json: { id: 'request-r3', threadId: task.threadId, status: 'succeeded', model: 'mock', bytes: 3, limitBytes: 100, hasSnapshot: true, inputs: [{ kind: 'file', fileId: 'f-r3', sourceLabel: '근거.txt', weight: 'reference', bytes: 3 }] } }))
  await page.goto(`/c/${task.id}`)
  await expect(page.getByRole('button', { name: '전송 기록', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '이 대화 파일로 저장' })).toBeVisible()
  for (const name of ['체크리스트', '메모', '활동 이력'] as const) {
    await openWorkTool(page, name)
    const label = { '체크리스트': '체크', '메모': '메모', '활동 이력': '이력' }[name]
    await expect(page.getByRole('tabpanel', { name: label, exact: true })).toBeVisible()
  }
  await page.getByRole('button', { name: '더 보기', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: '전송 기록', exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  // 실패 응답에서만 기록·재시도를 노출한다.
  await page.unroute(`**/api/threads/${task.threadId}/messages`)
  await page.route(`**/api/threads/${task.threadId}/messages`, route => route.fulfill({ json: [{ ...reply, status: 'error', error: 'R3 error' }] }))
  await page.reload()
  for (const [action, title] of [['전송 기록', '사용한 자료'], ['파일 빼고 다시', '다시 보낼 때 뺄 파일'], ['텍스트로 보내기', '본문으로 보낼 텍스트 파일']]) {
    await page.getByRole('button', { name: '더 보기', exact: true }).click()
    await page.getByRole('menuitem', { name: action, exact: true }).click()
    await expect(page.getByRole('dialog', { name: title })).toBeVisible()
    await page.keyboard.press('Escape')
  }
  await revealMaterials(page)
  await page.getByRole('button', { name: '더 보기', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: new RegExp(task.code) })).toBeVisible()
  await expect(page.getByRole('menuitemradio', { name: '보통' })).toBeChecked()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: '더 보기', exact: true })).toBeFocused()
  // 오류가 오면 임시 버튼을 같은 헤더에 노출한다.
  await page.unroute(`**/api/threads/${task.threadId}/messages`)
  await page.route(`**/api/threads/${task.threadId}/messages`, route => route.fulfill({ json: [{ ...reply, status: 'error', error: 'R3 error' }] }))
  await page.reload()
  await expect(page.getByRole('button', { name: '전송 기록', exact: true })).toBeVisible()
})

test('900px 하단 바에서 직접 펼친 시트는 대화 본문 높이의 70% 이내다', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 })
  const { create } = await setup(page)
  const task = await create(['R3-narrow'])
  await page.goto(`/c/${task.id}`)
  const active = page.locator('[data-tab-panel]:not([inert])')
  const toggle = linkedMaterialsToggle(active)
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(active.getByRole('navigation', { name: '업무 도구' })).toBeVisible()
  await toggle.click()
  const sheet = active.getByRole('dialog', { name: '대화 보조 패널' })
  await expect(sheet).toBeVisible()
  const bodyBox = await active.getByTestId('task-body').boundingBox()
  const panelBox = await sheet.boundingBox()
  expect(panelBox!.height).toBeLessThanOrEqual(bodyBox!.height * 0.7 + 1)
  await sheet.getByRole('button', { name: '접기', exact: true }).click()
  await expect(toggle).toBeFocused()
})
