import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { useUiStore } from '@/app/uiStore'
import { renderWithProviders } from '@/test/render'
import { CardMapFilterBar } from './CardMapFilterBar'

it('Lv2 칩의 키보드·전체 선택을 필터에 반영하고 Lv1 변경은 Lv2를 초기화한다', async () => {
  useUiStore.getState().setHomeFilters({ level1CodeId: 'l1', level2CodeId: null })
  function Filter() {
    const filters = useUiStore(s => s.homeFilters)
    return <CardMapFilterBar level1Options={[{ id: 'l1', label: '분류' }, { id: 'other', label: '다른 분류' }]} level2Options={[{ id: 'sub1', label: '하위 하나' }, { id: 'sub2', label: '하위 둘' }]} level1CodeId={filters.level1CodeId} level2CodeId={filters.level2CodeId} />
  }
  const user = userEvent.setup()
  renderWithProviders(<Filter />)
  const all = screen.getByRole('radio', { name: '전체' })
  expect(all).toBeChecked()
  all.focus()
  await user.keyboard('{ArrowRight}')
  expect(screen.getByRole('radio', { name: '하위 하나' })).toHaveFocus()
  await user.keyboard(' ')
  expect(useUiStore.getState().homeFilters.level2CodeId).toBe('sub1')
  await user.click(screen.getByRole('radio', { name: '하위 둘' }))
  expect(useUiStore.getState().homeFilters.level2CodeId).toBe('sub2')
  await user.click(all)
  expect(useUiStore.getState().homeFilters.level2CodeId).toBeNull()
  await user.click(screen.getByRole('radio', { name: '하위 하나' }))
  await user.click(screen.getByRole('radio', { name: '다른 분류' }))
  expect(useUiStore.getState().homeFilters).toMatchObject({ level1CodeId: 'other', level2CodeId: null })
})
