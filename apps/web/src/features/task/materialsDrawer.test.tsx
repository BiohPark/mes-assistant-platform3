import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import type { Task } from '@mes/domain'
import { bindRailToUser, clearRailState, useDrawerOpen, useMaterialsDrawer, useRailState } from './materialsDrawer'
afterEach(() => { sessionStorage.clear(); useMaterialsDrawer.setState({ byTask: {} }) })
it('태그·SR·메시지는 자동 펼침을 일으키지 않고 사용자의 선택만 복원한다', () => {
  const task = { id: 'policy', tags: ['A'], linkedSrCodes: ['SR-2026-0001'] } as unknown as Task
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
  const { result, rerender, unmount } = renderHook(({ value }) => useDrawerOpen(value), { wrapper, initialProps: { value: task } })
  expect(result.current).toBe(false)
  rerender({ value: { ...task, tags: ['A', 'B'] } })
  expect(result.current).toBe(false)
  act(() => useMaterialsDrawer.getState().choose(task.id, 'open', 'notes'))
  expect(result.current).toBe(true)
  unmount()
  useMaterialsDrawer.setState({ byTask: {} })
  const restored = renderHook(() => useDrawerOpen(task))
  expect(restored.result.current).toBe(true)
  act(() => useMaterialsDrawer.getState().choose(task.id, 'closed'))
  expect(restored.result.current).toBe(false)
})

it('작성 중 초안·펼침은 사용자별 — 다른 계정으로 바뀌거나 로그아웃하면 이전 사용자의 것을 복원하지 않는다', () => {
  bindRailToUser('alice')
  act(() => { useMaterialsDrawer.getState().choose('shared', 'open', 'notes'); useMaterialsDrawer.getState().update('shared', { noteDraft: 'A의 미저장 메모', checklistDraft: 'A 항목' }) })
  expect(renderHook(() => useRailState('shared')).result.current.noteDraft).toBe('A의 미저장 메모')
  bindRailToUser('bob') // 같은 브라우저 탭에서 다른 계정 로그인 — 메모리·세션 모두
  const bob = renderHook(() => useRailState('shared')).result.current
  expect(bob).toMatchObject({ choice: 'closed', noteDraft: '', checklistDraft: '' })
  useMaterialsDrawer.setState({ byTask: {} }) // 새로고침 뒤 세션 저장분에서도
  expect(renderHook(() => useRailState('shared')).result.current.noteDraft).toBe('')
  act(() => useMaterialsDrawer.getState().update('shared', { noteDraft: 'B 메모' }))
  bindRailToUser('bob')
  expect(renderHook(() => useRailState('shared')).result.current.noteDraft).toBe('B 메모') // 같은 사용자는 유지
  act(() => clearRailState())
  expect(renderHook(() => useRailState('shared')).result.current.noteDraft).toBe('')
  expect(Object.keys(sessionStorage).filter(key => key.startsWith('mes-hub:panel-state:'))).toEqual([])
})
