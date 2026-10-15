import { beforeEach, expect, it, vi } from 'vitest'
import { guideOfferKey, offerGuideOnce, saveGuideOffer } from './tutorial'
import { newId } from '@/lib/ids'

let userId = ''
beforeEach(() => { vi.restoreAllMocks(); localStorage.clear(); sessionStorage.clear(); userId = newId() })

it('offers once per user and page, even when the first bubble is closed without an answer', () => {
  expect(offerGuideOnce(userId, 'hub')).toBe(true)
  expect(localStorage.getItem(guideOfferKey(userId, 'hub'))).toBe('asked')
  expect(offerGuideOnce(userId, 'hub')).toBe(false)
  expect(offerGuideOnce(userId, 'conversation')).toBe(true) // 페이지마다 따로 센다
})

it.each(['accepted', 'skipped'] as const)('preserves %s and isolates users', state => {
  saveGuideOffer(userId, 'sr', state)
  expect(offerGuideOnce(userId, 'sr')).toBe(false)
  expect(localStorage.getItem(guideOfferKey(userId, 'sr'))).toBe(state)
  expect(offerGuideOnce(`${userId}-other`, 'sr')).toBe(true)
})

it('storage failure shows once per session even if reading succeeds', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
  expect(offerGuideOnce(userId, 'hub')).toBe(true)
  expect(offerGuideOnce(userId, 'hub')).toBe(false)
})

it('storage access failure shows once per session', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
  expect(offerGuideOnce(userId, 'hub')).toBe(true)
  saveGuideOffer(userId, 'hub', 'skipped')
  expect(offerGuideOnce(userId, 'hub')).toBe(false)
})

it('browser state survives a new runtime', async () => {
  expect(offerGuideOnce(userId, 'hub')).toBe(true)
  vi.resetModules()
  const fresh = await import('./tutorial')
  expect(fresh.offerGuideOnce(userId, 'hub')).toBe(false)
})

it('restores session fallback after a reload when only localStorage fails', async () => {
  const original = Storage.prototype.setItem
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (this === localStorage) throw new Error('quota')
    original.call(this, key, value)
  })
  expect(offerGuideOnce(userId, 'hub')).toBe(true)
  expect(sessionStorage.getItem(guideOfferKey(userId, 'hub'))).toBe('asked')
  vi.resetModules()
  const fresh = await import('./tutorial')
  expect(fresh.offerGuideOnce(userId, 'hub')).toBe(false)
})
