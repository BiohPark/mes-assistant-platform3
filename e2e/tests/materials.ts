import { expect, type Locator, type Page } from '@playwright/test'

/** 가이드 섹션·공유 말풍선과 구분하고 MDI의 숨은 대화는 제외한다. */
export function linkedMaterialsToggle(root: Page | Locator) {
  return root.getByRole('button', { name: /^자료/ })
    .and(root.locator('[data-tour="linked-materials"]'))
}

export async function revealMaterials(page: Page) {
  const toggle = linkedMaterialsToggle(page)
  await expect(toggle).toBeVisible()
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
}
export async function openWorkTool(page: Page, name: '체크리스트' | '메모' | '활동 이력') {
  const label = { '체크리스트': '체크', '메모': '메모', '활동 이력': '이력' }[name]
  const entry = page.getByRole('navigation', { name: '업무 도구' }).getByRole('button', { name: new RegExp(`^${label}`) })
  if (await entry.getAttribute('aria-pressed') !== 'true') await entry.click()
}

/** 두 표시 상태에서 같은 항목을 추적한다. */
export function materialToggleName(label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^(?:\\+ 첨부|첨부됨 ✓) · ${escaped}$`)
}
