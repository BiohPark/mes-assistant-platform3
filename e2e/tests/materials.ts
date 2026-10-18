import { expect, type Locator, type Page } from '@playwright/test'

/** 가이드 섹션·공유 말풍선과 구분하고 MDI의 숨은 대화는 제외한다. */
export function linkedMaterialsToggle(root: Page | Locator) {
  return root.getByRole('button', { name: /^연결 자료(?:\(\d+\))?$/ })
    .and(root.locator('[data-tour="linked-materials"]'))
}

export async function revealMaterials(page: Page) {
  const toggle = linkedMaterialsToggle(page)
  await expect(toggle).toBeVisible()
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
}
export async function openWorkTool(page: Page, name: '체크리스트' | '메모' | '활동 이력') {
  await page.getByRole('button', { name: '더 보기', exact: true }).click()
  await page.getByRole('menuitem', { name: `${name} 열기`, exact: true }).click()
}

/** 두 표시 상태에서 같은 항목을 추적한다. */
export function materialToggleName(label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^(?:\\+ 첨부|첨부됨 ✓) · ${escaped}$`)
}
