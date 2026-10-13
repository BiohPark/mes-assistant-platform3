import { render } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useShortcut } from './useShortcut'

function Probe({ action }: { action: () => void }) { useShortcut('k', action); return null }
it('intercepts Ctrl+K but ignores composing and Ctrl+F, and removes the listener', () => {
  const action = vi.fn()
  const { unmount } = render(<Probe action={action} />)
  const dispatch = (key: string, isComposing = false, keyCode = 0) => {
    const event = new KeyboardEvent('keydown', { key, ctrlKey: true, isComposing, keyCode, cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
  }
  expect(dispatch('k', true)).toBe(false)
  expect(dispatch('k', false, 229)).toBe(false)
  expect(dispatch('f')).toBe(false)
  expect(action).not.toHaveBeenCalled()
  expect(dispatch('k')).toBe(true)
  expect(action).toHaveBeenCalledOnce()
  unmount()
  expect(dispatch('k')).toBe(false)
})
