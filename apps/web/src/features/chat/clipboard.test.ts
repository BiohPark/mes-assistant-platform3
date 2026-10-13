import { afterEach, expect, it, vi } from 'vitest'
import { copyText } from '@/lib/clipboard'

afterEach(() => vi.restoreAllMocks())
it.each([true, false, 'throws'] as const)('cleans up and restores focus after a denied clipboard fallback (%s)', async (result) => {
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  const exec = Object.getOwnPropertyDescriptor(document, 'execCommand')
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
  Object.defineProperty(document, 'execCommand', { configurable: true, value: () => {
    expect(document.querySelector('textarea')).toHaveValue('**Markdown**')
    if (result === 'throws') throw new Error('unavailable')
    return result
  } })
  const button = document.createElement('button')
  document.body.append(button)
  button.focus()
  try {
    expect(await copyText('**Markdown**')).toBe(result === true)
    expect(document.querySelector('textarea')).toBeNull()
    expect(button).toHaveFocus()
  } finally {
    button.remove()
    if (original) Object.defineProperty(navigator, 'clipboard', original)
    else Reflect.deleteProperty(navigator, 'clipboard')
    if (exec) Object.defineProperty(document, 'execCommand', exec)
    else Reflect.deleteProperty(document, 'execCommand')
  }
})
