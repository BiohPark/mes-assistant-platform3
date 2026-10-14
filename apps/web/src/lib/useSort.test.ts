import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { compareValues, sortRows, useSort } from './useSort'

type Row = { name: string; count?: number; retired: boolean; order: number }
const rows: Row[] = [
  { name: '나', count: 2, retired: true, order: 1 },
  { name: '가', count: undefined, retired: false, order: 2 },
  { name: '다', count: 10, retired: false, order: 3 },
]
const columns = { name: (row: Row) => row.name, count: (row: Row) => row.count }
const retiredLast = (a: Row, b: Row) => Number(a.retired) - Number(b.retired) || a.order - b.order

describe('compareValues', () => {
  it('숫자는 수치로, 문자열은 자연 정렬로 비교한다', () => {
    expect(compareValues(2, 10)).toBeLessThan(0)
    expect(compareValues('a2', 'a10')).toBeLessThan(0)
    expect(compareValues('가', '나')).toBeLessThan(0)
  })
})

describe('sortRows', () => {
  it('정렬 없음은 기본 비교(폐기 맨 아래)만 적용하고 원본을 바꾸지 않는다', () => {
    const sorted = sortRows(rows, columns, null, retiredLast)
    expect(sorted.map(row => row.name)).toEqual(['가', '다', '나'])
    expect(rows[0]!.name).toBe('나')
  })
  it('열 정렬은 방향을 따르고 빈 값은 항상 맨 아래, 동률은 기본 비교로 가른다', () => {
    expect(sortRows(rows, columns, { key: 'count', direction: 'asc' }, retiredLast).map(row => row.name)).toEqual(['나', '다', '가'])
    expect(sortRows(rows, columns, { key: 'count', direction: 'desc' }, retiredLast).map(row => row.name)).toEqual(['다', '나', '가'])
    expect(sortRows(rows, columns, { key: 'name', direction: 'desc' }).map(row => row.name)).toEqual(['다', '나', '가'])
  })
})

describe('useSort', () => {
  it('같은 열을 누르면 오름 → 내림 → 기본 순으로 바뀌고 다른 열은 오름부터 시작한다', () => {
    const { result } = renderHook(() => useSort(rows, columns, retiredLast))
    expect(result.current.sort).toBeNull()
    expect(result.current.rows.map(row => row.name)).toEqual(['가', '다', '나'])
    act(() => result.current.toggle('name'))
    expect(result.current.sort).toEqual({ key: 'name', direction: 'asc' })
    expect(result.current.rows.map(row => row.name)).toEqual(['가', '나', '다'])
    act(() => result.current.toggle('name'))
    expect(result.current.sort).toEqual({ key: 'name', direction: 'desc' })
    act(() => result.current.toggle('count'))
    expect(result.current.sort).toEqual({ key: 'count', direction: 'asc' })
    act(() => result.current.toggle('count'))
    act(() => result.current.toggle('count'))
    expect(result.current.sort).toBeNull()
    expect(result.current.rows.map(row => row.name)).toEqual(['가', '다', '나'])
  })
})
