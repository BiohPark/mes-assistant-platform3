import { describe, it, expect, vi, afterEach } from 'vitest'
import { copyText } from './clipboard'

const originalClipboard = navigator.clipboard

afterEach(() => {
  Object.defineProperty(navigator, 'clipboard', { value: originalClipboard, configurable: true })
})

describe('copyText', () => {
  it('uses navigator.clipboard when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    expect(await copyText('abc')).toBe(true)
    expect(writeText).toHaveBeenCalledWith('abc')
  })
  it('falls back to execCommand when clipboard API is missing (HTTP LAN)', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    const exec = vi.fn().mockReturnValue(true)
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true })
    expect(await copyText('abc')).toBe(true)
    expect(exec).toHaveBeenCalledWith('copy')
  })
  it('returns false when both paths fail', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    Object.defineProperty(document, 'execCommand', { value: () => false, configurable: true })
    expect(await copyText('abc')).toBe(false)
  })
})
