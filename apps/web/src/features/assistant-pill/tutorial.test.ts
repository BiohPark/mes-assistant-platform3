import { beforeEach, expect, it, vi } from 'vitest'
import { guideOfferKey, offerGuideOnce, offerGuideThisSession, saveGuideOffer } from './tutorial'
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

it('section progress is per user and page, de-duplicated, and tolerates corrupt or blocked storage', async () => {
  const { markSectionDone, readTourProgress, tourProgressKey } = await import('./tutorial')
  expect(readTourProgress(userId, 'conversation')).toEqual([])
  expect(markSectionDone(userId, 'conversation', 'basics')).toEqual(['basics'])
  expect(markSectionDone(userId, 'conversation', 'basics')).toEqual(['basics'])
  expect(markSectionDone(userId, 'conversation', 'tags')).toEqual(['basics', 'tags'])
  expect(JSON.parse(localStorage.getItem(tourProgressKey(userId, 'conversation'))!)).toEqual(['basics', 'tags'])
  expect(readTourProgress(userId, 'hub')).toEqual([])
  expect(readTourProgress(`${userId}-other`, 'conversation')).toEqual([])
  localStorage.setItem(tourProgressKey(userId, 'hub'), '{not json')
  expect(readTourProgress(userId, 'hub')).toEqual([])
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
  expect(markSectionDone(userId, 'sr', 'basics')).toEqual(['basics']) // 저장이 막혀도 이번 투어에는 반영
})

it('the agent editor guide is offered once per user, like a page', () => {
  expect(offerGuideOnce(userId, 'assistantEditor')).toBe(true)
  expect(offerGuideOnce(userId, 'assistantEditor')).toBe(false)
  expect(localStorage.getItem(guideOfferKey(userId, 'assistantEditor'))).toBe('asked')
})

it('S14 코치: 페이지 제안은 세션당 한 번 — 끝까지 보거나(done) 다시 묻지 않기(skipped)를 고르기 전까지 다음 세션에 다시 가볍게 묻는다', async () => {
  expect(offerGuideThisSession(userId, 'hub')).toBe(true)
  expect(localStorage.getItem(guideOfferKey(userId, 'hub'))).toBe('asked')
  expect(offerGuideThisSession(userId, 'hub')).toBe(false) // 같은 세션
  expect(offerGuideThisSession(userId, 'sr')).toBe(true) // 페이지마다 따로
  let fresh = await reload()
  expect(fresh.offerGuideThisSession(userId, 'hub')).toBe(false) // 새로고침(sessionStorage 유지)은 같은 세션
  sessionStorage.clear()
  fresh = await reload()
  expect(fresh.offerGuideThisSession(userId, 'hub')).toBe(true) // 새 세션 — 아직 끝까지 안 봤다
  fresh.saveGuideOffer(userId, 'hub', 'accepted') // 시작만 하고 그만둔 경우도 다시 묻는다
  sessionStorage.clear()
  fresh = await reload()
  expect(fresh.offerGuideThisSession(userId, 'hub')).toBe(true)
  for (const state of ['done', 'skipped'] as const) {
    fresh.saveGuideOffer(userId, 'myWork', state)
    sessionStorage.clear()
    fresh = await reload()
    expect(fresh.offerGuideThisSession(userId, 'myWork')).toBe(false)
    localStorage.clear()
  }
})

it('S14 코치: 끝까지 본 기록(done)은 다시 보기의 accepted로 덮이지 않는다', () => {
  saveGuideOffer(userId, 'conversation', 'done')
  saveGuideOffer(userId, 'conversation', 'accepted')
  expect(localStorage.getItem(guideOfferKey(userId, 'conversation'))).toBe('done')
  expect(offerGuideThisSession(userId, 'conversation')).toBe(false)
})

it('S14 코치: 저장이 모두 막혀도 세션 제안은 한 번', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
  expect(offerGuideThisSession(userId, 'hub')).toBe(true)
  expect(offerGuideThisSession(userId, 'hub')).toBe(false)
})

async function reload() {
  vi.resetModules()
  return import('./tutorial')
}
