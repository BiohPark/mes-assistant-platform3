import type { ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import type { SortState } from '@/lib/useSort'
import { cn } from '@/lib/utils'

const ARIA_SORT = { asc: 'ascending', desc: 'descending' } as const

/** useSort와 짝인 열 머리 — 버튼으로 토글하고 활성 열에만 aria-sort를 둔다 */
export function SortHeader<K extends string>({ column, sort, onToggle, className, children }: { column: K; sort: SortState<K>; onToggle: (key: K) => void; className?: string; children: ReactNode }) {
  const active = sort?.key === column ? sort.direction : undefined
  const Icon = active === 'asc' ? ArrowUp : active === 'desc' ? ArrowDown : ArrowUpDown
  return <th scope="col" aria-sort={active && ARIA_SORT[active]} className={cn('p-2', className)}>
    <button type="button" onClick={() => onToggle(column)} className={cn('inline-flex items-center gap-1 rounded-md text-left outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring', !active && 'text-muted-foreground')}>
      {children}<Icon aria-hidden className={cn('size-3 shrink-0', !active && 'opacity-60')} />
    </button>
  </th>
}
