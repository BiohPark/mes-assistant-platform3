import type { KeyboardEvent } from 'react'

/**
 * 수동 tablist의 키보드 규약(APG tabs): roving tabIndex + ←/→(세로는 ↑/↓)·Home/End, 자동 활성화.
 * DOM의 role="tab" 순서가 values 순서와 같아야 포커스가 맞게 옮겨진다. Radix 교체 없음.
 */
export function useTablistKeys<T extends string>(values: readonly T[], active: T, onChange: (value: T) => void,
  { orientation = 'horizontal' }: { orientation?: 'horizontal' | 'vertical' } = {}) {
  const [previous, next] = orientation === 'vertical' ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight']
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const index = values.indexOf(active)
    let target: number
    if (event.key === next) target = (index + 1) % values.length
    else if (event.key === previous) target = (index - 1 + values.length) % values.length
    else if (event.key === 'Home') target = 0
    else if (event.key === 'End') target = values.length - 1
    else return
    event.preventDefault()
    onChange(values[target])
    event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[target]?.focus()
  }
  return {
    tablistProps: { onKeyDown, ...(orientation === 'vertical' && { 'aria-orientation': 'vertical' as const }) },
    tabProps: (value: T) => ({ role: 'tab' as const, 'aria-selected': value === active, tabIndex: value === active ? 0 : -1 }),
  }
}
