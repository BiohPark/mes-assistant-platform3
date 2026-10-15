import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const password = 'e2e-password-1234'
/** 1×1 투명 PNG — 매직바이트·IHDR이 진짜다 */
const ONE_PX_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
const IMAGE = '/api/settings/assistant-image'

async function signUp(page: Page) {
  await page.goto('/signup')
  await page.getByLabel('ID').fill(`e2e-pill-${Date.now().toString(36)}`)
  await page.getByLabel('비밀번호', { exact: true }).fill(password)
  await page.getByLabel('이름').fill('가상 사용자')
  await page.getByLabel('비밀번호 확인').fill(password)
  await page.getByRole('button', { name: '회원가입' }).click()
  await expect(page).toHaveURL(/\/$/)
}
async function owner(api: APIRequestContext) {
  // E2E 서버가 dev-owner를 시드한다(admin.spec과 같은 경로)
  expect((await api.post('/api/auth/login', { data: { loginId: 'dev-owner', password } })).ok()).toBe(true)
}
const upload = (api: APIRequestContext, name: string, buffer: Buffer) => api.post(IMAGE, { multipart: { file: { name, mimeType: 'image/png', buffer } } })

test('알약을 끌면 창이 열리지 않고 위치가 남으며, 클릭·Esc로 열고 닫으면 포커스가 알약으로 돌아간다', async ({ page }) => {
  await signUp(page)
  const pill = page.getByRole('button', { name: 'AI 도우미 열기' })
  await expect(pill).toBeVisible()
  const before = (await pill.boundingBox())!
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2)
  await page.mouse.down()
  expect(before.x).toBeLessThan(56) // 기본 위치는 사이드바 하단(왼쪽) — 입력창 전송 버튼을 가리지 않는다
  await page.mouse.move(before.x + before.width / 2 + 200, before.y + before.height / 2 - 120, { steps: 8 })
  await expect.poll(() => pill.evaluate(el => el.style.transform)).toMatch(/^translate3d\(200px, -120px, 0(px)?\)$/) // 끌기 중에는 transform만(프레임마다) — 저장은 놓을 때 한 번. 브라우저는 0을 0px로 직렬화한다
  expect(await pill.evaluate(el => el.style.left)).toBe('16px')
  await page.mouse.up()
  expect(await pill.evaluate(el => el.style.transform)).toBe('')
  await expect(page.getByRole('dialog', { name: '시스템 assistant' })).toHaveCount(0) // 끌기 뒤의 클릭은 토글이 아니다
  const after = (await pill.boundingBox())!
  expect(Math.round(after.x)).toBe(Math.round(before.x + 200))
  expect(Math.round(after.y)).toBe(Math.round(before.y - 120))
  await page.reload()
  await expect(pill).toBeVisible()
  const restored = (await pill.boundingBox())!
  expect(Math.round(restored.x)).toBe(Math.round(after.x)) // uiStore persist
  await pill.click()
  const dialog = page.getByRole('dialog', { name: '시스템 assistant' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveAttribute('data-testid', 'assistant-window') // Desktop Chrome(≥1024) → 인접 팝오버
  await expect(dialog.getByRole('button', { name: '시스템 assistant 닫기' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'AI 도우미 열기' })).toBeFocused()
  await page.keyboard.press('Home')
  const reset = (await pill.boundingBox())!
  expect(Math.round(reset.x)).toBe(Math.round(before.x))
})

test('캐릭터 이미지는 SO만 올리고, 확장자만 PNG인 파일은 거부되며, 올린 이미지가 알약에 대체 텍스트와 함께 보인다', async ({ page, playwright, baseURL }) => {
  await signUp(page)
  expect((await page.request.post(IMAGE, { multipart: { file: { name: 'c.png', mimeType: 'image/png', buffer: ONE_PX_PNG } } })).status()).toBe(403) // 담당자
  const api = await playwright.request.newContext({ baseURL, timeout: 5_000 })
  try {
    await owner(api)
    expect((await upload(api, 'fake.png', Buffer.from('확장자만 png'))).status()).toBe(400)
    const wide = Buffer.from(ONE_PX_PNG); wide.writeUInt32BE(513, 16)
    expect((await upload(api, 'wide.png', wide)).status()).toBe(400)
    const saved = await upload(api, '캐릭터.png', ONE_PX_PNG)
    expect(saved.status()).toBe(201)
    const fileId = (await saved.json()).assistantImageFileId as string
    expect(fileId).toBeTruthy()
    await page.reload()
    const image = page.getByRole('button', { name: 'AI 도우미 열기' }).getByRole('img', { name: 'AI 도우미 캐릭터' })
    await expect(image).toBeVisible()
    await expect(image).toHaveAttribute('src', `/api/settings/assistant-image?v=${fileId}`)
    const content = await page.request.get('/api/settings/assistant-image') // 로그인 사용자 열람 — 현재 설정의 파일만, 권한 검사 없이
    expect(content.status()).toBe(200)
    expect(content.headers()['content-type']).toMatch(/^image\/png/)
  } finally {
    expect((await api.delete(IMAGE)).status()).toBe(204)
    await api.dispose()
  }
  await page.reload()
  await expect(page.getByRole('button', { name: 'AI 도우미 열기' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'AI 도우미 캐릭터' })).toHaveCount(0)
})
