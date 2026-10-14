import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useAutoSave } from './useAutoSave'

describe('useAutoSave', () => {
  it('저장 중 → 저장됨을 키별로 기록하고 성공 여부를 돌려준다', async () => {
    const { result } = renderHook(() => useAutoSave<'name' | 'email'>())
    let finish!: () => void
    let ok: boolean | undefined
    act(() => { void result.current.run('name', () => new Promise<void>(resolve => { finish = resolve })).then(value => { ok = value }) })
    expect(result.current.states.name).toEqual({ status: 'saving' })
    expect(result.current.states.email).toBeUndefined()
    await act(async () => { finish() })
    expect(result.current.states.name).toEqual({ status: 'saved' })
    expect(ok).toBe(true)
  })
  it('실패는 메시지와 함께 오류로 남고 fail로 직접 표시할 수 있다', async () => {
    const { result } = renderHook(() => useAutoSave<'name'>())
    let ok: boolean | undefined
    await act(async () => { ok = await result.current.run('name', () => Promise.reject(new Error('서버 거부'))) })
    expect(result.current.states.name).toEqual({ status: 'error', message: '서버 거부' })
    expect(ok).toBe(false)
    act(() => result.current.fail('name', '이름을 입력하세요'))
    expect(result.current.states.name).toEqual({ status: 'error', message: '이름을 입력하세요' })
    act(() => result.current.clear('name'))
    expect(result.current.states.name).toBeUndefined()
  })
  it('같은 키의 늦은 응답은 최신 호출 결과를 덮어쓰지 않는다', async () => {
    const { result } = renderHook(() => useAutoSave<'name'>())
    let finishFirst!: () => void
    let finishSecond!: () => void
    act(() => { void result.current.run('name', () => new Promise<void>(resolve => { finishFirst = resolve })) })
    act(() => { void result.current.run('name', () => new Promise<void>((_, reject) => { finishSecond = () => reject(new Error('늦은 실패')) })) })
    await act(async () => { finishSecond() })
    expect(result.current.states.name).toEqual({ status: 'error', message: '늦은 실패' })
    await act(async () => { finishFirst() })
    expect(result.current.states.name).toEqual({ status: 'error', message: '늦은 실패' })
  })
})
