import { useCallback, useState } from 'react'

export type SortValue = string | number | boolean | null | undefined
export type SortDirection = 'asc' | 'desc'
export type SortState<K extends string> = { key: K; direction: SortDirection } | null
export type SortColumns<T, K extends string> = Record<K, (row: T) => SortValue>

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
const isEmpty = (value: SortValue) => value === null || value === undefined || value === ''

/** 숫자·불리언은 수치로, 그 외는 자연 정렬(숫자 인식) 문자열로 비교한다. 빈 값은 호출 측에서 먼저 가른다 */
export function compareValues(a: SortValue, b: SortValue): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
  return collator.compare(String(a), String(b))
}

/** 열 정렬이 없으면 fallback(기본 순서)만, 있으면 열 값(빈 값은 방향과 무관하게 맨 아래) → fallback 순으로 정렬한 새 배열 */
export function sortRows<T, K extends string>(rows: T[], columns: SortColumns<T, K>, sort: SortState<K>, fallback?: (a: T, b: T) => number): T[] {
  const pick = sort ? columns[sort.key] : undefined
  const sign = sort?.direction === 'desc' ? -1 : 1
  return [...rows].sort((a, b) => {
    if (pick) {
      const [va, vb] = [pick(a), pick(b)]
      const [ea, eb] = [isEmpty(va), isEmpty(vb)]
      if (ea !== eb) return ea ? 1 : -1
      const order = ea ? 0 : compareValues(va, vb) * sign
      if (order) return order
    }
    return fallback?.(a, b) ?? 0
  })
}

/** 표 공용 정렬 — 같은 열을 누르면 오름 → 내림 → 기본(fallback) 순으로 돌아간다 */
export function useSort<T, K extends string>(rows: T[], columns: SortColumns<T, K>, fallback?: (a: T, b: T) => number) {
  const [sort, setSort] = useState<SortState<K>>(null)
  const toggle = useCallback((key: K) => setSort(current => current?.key !== key ? { key, direction: 'asc' } : current.direction === 'asc' ? { key, direction: 'desc' } : null), [])
  return { rows: sortRows(rows, columns, sort, fallback), sort, toggle }
}
