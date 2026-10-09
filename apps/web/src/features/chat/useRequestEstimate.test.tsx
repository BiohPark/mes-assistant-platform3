import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useRequestEstimate } from './useRequestEstimate'

const estimateRequest = vi.hoisted(() => vi.fn())
vi.mock('@/api/requests', () => ({ estimateRequest }))

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }) })
afterEach(() => { vi.useRealTimers(); estimateRequest.mockReset() })

const estimate = (bytes: number) => ({ bytes, limitBytes: 1000, inputs: [], srCodes: [], overLimit: false, attachmentLimit: 10 })
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>

function mount(initial: { draft: string; revision: string }) {
  return renderHook(({ draft, revision }) => useRequestEstimate('h', draft, revision, true), { initialProps: initial, wrapper })
}

it('keeps the previous estimate while a draft change is pending', async () => {
  estimateRequest.mockResolvedValueOnce(estimate(100)).mockResolvedValueOnce(estimate(200))
  const { result, rerender } = mount({ draft: 'a', revision: 'r1' })
  expect(result.current).toEqual({ data: undefined, pending: true, revisionChanged: false })
  await act(() => vi.advanceTimersByTimeAsync(400))
  await waitFor(() => expect(result.current.data?.bytes).toBe(100))
  expect(result.current).toMatchObject({ pending: false, revisionChanged: false })

  rerender({ draft: 'ab', revision: 'r1' })
  expect(result.current).toMatchObject({ data: { bytes: 100 }, pending: true, revisionChanged: false })
  await act(() => vi.advanceTimersByTimeAsync(400))
  await waitFor(() => expect(result.current.data?.bytes).toBe(200))
  expect(result.current).toMatchObject({ pending: false, revisionChanged: false })
  expect(estimateRequest).toHaveBeenCalledTimes(2)
  expect(estimateRequest).toHaveBeenLastCalledWith('h', { draft: 'ab' })
})

it('flags a revision change while keeping the previous estimate', async () => {
  estimateRequest.mockResolvedValueOnce(estimate(100)).mockResolvedValueOnce(estimate(50))
  const { result, rerender } = mount({ draft: 'a', revision: 'r1' })
  await act(() => vi.advanceTimersByTimeAsync(400))
  await waitFor(() => expect(result.current.data?.bytes).toBe(100))

  rerender({ draft: 'a', revision: 'r2' })
  expect(result.current).toMatchObject({ data: { bytes: 100 }, pending: true, revisionChanged: true })
  await act(() => vi.advanceTimersByTimeAsync(400))
  await waitFor(() => expect(result.current.data?.bytes).toBe(50))
  expect(result.current).toMatchObject({ pending: false, revisionChanged: false })
})

it('stops pending after a failed estimate instead of waiting forever', async () => {
  estimateRequest.mockResolvedValueOnce(estimate(100)).mockRejectedValueOnce(new Error('추정 실패'))
  const { result, rerender } = mount({ draft: 'a', revision: 'r1' })
  await act(() => vi.advanceTimersByTimeAsync(400))
  await waitFor(() => expect(result.current.data?.bytes).toBe(100))
  rerender({ draft: 'ab', revision: 'r1' })
  await act(() => vi.advanceTimersByTimeAsync(400))
  await waitFor(() => expect(result.current.pending).toBe(false))
  expect(result.current.data?.bytes).toBe(100)
})

it('returns nothing without a thread', () => {
  const { result } = renderHook(() => useRequestEstimate(undefined, 'a', 'r1', false), { wrapper })
  expect(result.current).toEqual({ data: undefined, pending: false, revisionChanged: false })
  expect(estimateRequest).not.toHaveBeenCalled()
})
