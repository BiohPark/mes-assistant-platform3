import { expect, test } from '@playwright/test'

const password = 'e2e-password-1234'
const live = (process.env.E2E_LLM_MODE ?? process.env.LLM_MODE) === 'live'

async function signUp(page: import('@playwright/test').Page) {
  await page.goto('/signup')
  await page.getByLabel('ID').fill(`e2e-system-${Date.now().toString(36)}`)
  await page.getByLabel('비밀번호', { exact: true }).fill(password)
  await page.getByLabel('이름').fill('가상 사용자')
  await page.getByLabel('비밀번호 확인').fill(password)
  await page.getByRole('button', { name: '회원가입' }).click()
  await expect(page).toHaveURL(/\/$/)
}

test('제안 확인 후 대화를 만들고 새 대화로 이동한다', async ({ page }) => {
  await signUp(page)
  let taskWrites = 0
  page.on('request', (request) => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/tasks') taskWrites++ })
  await page.getByRole('button', { name: '시스템 assistant 열기' }).click()
  const drawer = page.getByRole('dialog', { name: '시스템 assistant' })
  await drawer.getByRole('textbox', { name: '팀 의견 입력' }).fill('FDS 작성 도우미로 "테스트" 대화 시작해줘')
  await drawer.getByRole('button', { name: '전송' }).click()
  if (live) {
    // 가짜 OpenWebUI는 도구 호출을 모른다 → 답변만 보이고 제안 카드는 없다(도구 미지원 모델과 같은 경로)
    await expect(drawer.getByText(/가짜 OpenWebUI/)).toBeVisible({ timeout: 15_000 })
    await expect(drawer.getByRole('button', { name: '적용' })).toHaveCount(0)
    expect(taskWrites).toBe(0)
    return
  }
  await expect(drawer.getByText(/대화 시작: FDS 작성.*— "테스트"/)).toBeVisible()
  expect(taskWrites).toBe(0)
  await drawer.getByRole('button', { name: '적용' }).click()
  await expect.poll(() => taskWrites).toBe(1)
  await expect(drawer.getByText(/대화를 FDS 작성 도우미와 시작했습니다/)).toBeVisible()
  await drawer.getByRole('button', { name: /이동/ }).click()
  await expect(page).toHaveURL(/\/c\/[^/]+$/)
})

test('담당자의 에이전트 등록 적용은 기존 API가 거부한다', async ({ page }) => {
  test.skip(live, 'Mock 규칙 전용 — 가짜 OpenWebUI는 도구 호출을 내지 않음')
  await signUp(page)
  await page.getByRole('button', { name: '시스템 assistant 열기' }).click()
  const drawer = page.getByRole('dialog', { name: '시스템 assistant' })
  await drawer.getByRole('textbox', { name: '팀 의견 입력' }).fill('에이전트 등록: ID e2e-denied, 이름 거부 확인 도우미, Record › Deviation')
  await drawer.getByRole('button', { name: '전송' }).click()
  await expect(drawer.getByText(/에이전트 등록: 거부 확인 도우미/)).toBeVisible()
  await drawer.getByRole('button', { name: '적용' }).click()
  await expect(drawer.getByText('권한이 없습니다')).toBeVisible()
})
