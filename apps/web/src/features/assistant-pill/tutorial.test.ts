import { beforeEach, expect, it, vi } from 'vitest'
import { askTutorialOnce, saveTutorialState, tutorialKey } from './tutorial'
import { newId } from '@/lib/ids'

let userId = ''
beforeEach(() => { vi.restoreAllMocks(); localStorage.clear(); sessionStorage.clear(); userId = newId() })

it('asks once per browser even when the first invitation is closed without an answer', () => {
  expect(askTutorialOnce(userId)).toBe(true)
  expect(localStorage.getItem(tutorialKey(userId))).toBe('asked')
  expect(askTutorialOnce(userId)).toBe(false)
})

it.each(['accepted', 'skipped'] as const)('preserves %s and isolates users', state => {
  saveTutorialState(userId, state)
  expect(askTutorialOnce(userId)).toBe(false)
  expect(askTutorialOnce(`${userId}-other`)).toBe(true)
})

it('storage failure shows once per session even if reading succeeds', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
  expect(askTutorialOnce(userId)).toBe(true)
  expect(askTutorialOnce(userId)).toBe(false)
})

it('storage access failure shows once per session', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
  expect(askTutorialOnce(userId)).toBe(true)
  saveTutorialState(userId, 'skipped')
  expect(askTutorialOnce(userId)).toBe(false)
})

it('browser state survives a new runtime', async () => {
  expect(askTutorialOnce(userId)).toBe(true)
  vi.resetModules()
  const fresh = await import('./tutorial')
  expect(fresh.askTutorialOnce(userId)).toBe(false)
})

it('restores session fallback after a reload when only localStorage fails', async () => {
  const original = Storage.prototype.setItem
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (this === localStorage) throw new Error('quota')
    original.call(this, key, value)
  })
  expect(askTutorialOnce(userId)).toBe(true)
  expect(sessionStorage.getItem(tutorialKey(userId))).toBe('asked')
  vi.resetModules()
  const fresh = await import('./tutorial')
  expect(fresh.askTutorialOnce(userId)).toBe(false)
})
