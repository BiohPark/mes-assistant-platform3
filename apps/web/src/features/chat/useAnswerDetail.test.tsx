import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, expect, it } from 'vitest'
import type { Me } from '@mes/contracts'
import { MeContext } from '@/app/auth'
import { useUiStore } from '@/app/uiStore'
import { useAnswerDetail } from './useAnswerDetail'
afterEach(() => { useUiStore.setState({ answerDetails: {} }); localStorage.clear() })
it('defaults to brief, isolates users and restores the chosen mode from persisted settings', async () => {
  useUiStore.setState({ answerDetails: {} })
  const wrapper = ({ children }: { children: ReactNode }) => <MeContext value={{ id: 'u1' } as Me}>{children}</MeContext>
  const { result } = renderHook(useAnswerDetail, { wrapper })
  expect(result.current.detail).toBe('brief')
  act(() => result.current.toggle())
  expect(result.current.detail).toBe('answer')
  act(() => result.current.toggle())
  expect(result.current.detail).toBe('full')
  act(() => useUiStore.getState().setAnswerDetail('u2', 'brief'))
  expect(result.current.detail).toBe('full')
  const stored = localStorage.getItem('mes-hub-ui')!
  act(() => useUiStore.setState({ answerDetails: {} }))
  localStorage.setItem('mes-hub-ui', stored)
  await act(async () => { await useUiStore.persist.rehydrate() })
  expect(result.current.detail).toBe('full')
  expect(useUiStore.getState().answerDetails.u2).toBe('brief')
})

it('follows a mode change made in another window of the same browser (pop-out)', async () => {
  const wrapper = ({ children }: { children: ReactNode }) => <MeContext value={{ id: 'u1' } as Me}>{children}</MeContext>
  const { result } = renderHook(useAnswerDetail, { wrapper })
  expect(result.current.detail).toBe('brief')
  const other = JSON.stringify({ state: { answerDetails: { u1: 'full' } }, version: (useUiStore.persist.getOptions().version ?? 0) })
  localStorage.setItem('mes-hub-ui', other)
  await act(async () => {
    window.dispatchEvent(new StorageEvent('storage', { key: 'mes-hub-ui', newValue: other }))
    await Promise.resolve()
  })
  expect(result.current.detail).toBe('full')
})


it('cycles full → brief → answer → full', () => {
  useUiStore.setState({ answerDetails: { anonymous: 'full' } })
  const { result } = renderHook(useAnswerDetail)
  act(() => result.current.toggle())
  expect(result.current.detail).toBe('brief')
  act(() => result.current.toggle())
  expect(result.current.detail).toBe('answer')
  act(() => result.current.toggle())
  expect(result.current.detail).toBe('full')
})

it('retains existing user modes during settings migration and persists answer-only mode', async () => {
  const migrate = useUiStore.persist.getOptions().migrate!
  expect(await migrate({ answerDetails: { u1: 'full', u2: 'brief' }, homeFilters: { q: 'MES' }, kanbanCompleted: { u1: true } }, 0)).toMatchObject({ answerDetails: { u1: 'full', u2: 'brief' }, kanbanCompleted: { u1: true } })
  act(() => useUiStore.getState().setAnswerDetail('u3', 'answer'))
  const saved = localStorage.getItem('mes-hub-ui')!
  act(() => useUiStore.setState({ answerDetails: {} }))
  localStorage.setItem('mes-hub-ui', saved)
  await act(async () => { await useUiStore.persist.rehydrate() })
  expect(useUiStore.getState().answerDetails.u3).toBe('answer')
})
