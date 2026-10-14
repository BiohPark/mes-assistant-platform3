import { afterEach, expect, it } from 'vitest'
import { bindDraftsToUser, clearDrafts, getDraft, setDraft } from './drafts'

afterEach(clearDrafts)

it('keeps one draft per conversation in memory, drops empty ones and clears everything on logout', () => {
  const file = new File(['x'], 'a.txt', { type: 'text/plain' })
  setDraft('a', { text: '초안', pending: [{ file }], discussion: true })
  setDraft('b', { text: '', pending: [], discussion: false })
  expect(getDraft('a')).toEqual({ text: '초안', pending: [{ file }], discussion: true })
  expect(getDraft('b')).toBeUndefined()
  setDraft('a', { text: '', pending: [], discussion: false })
  expect(getDraft('a')).toBeUndefined()
  setDraft('a', { text: '다시', pending: [], discussion: false })
  clearDrafts()
  expect(getDraft('a')).toBeUndefined()
})

it('discards the previous user\'s drafts when a different user signs in, and keeps them for the same user', () => {
  bindDraftsToUser('u1')
  setDraft('a', { text: '첫 사용자 초안', pending: [], discussion: false })
  bindDraftsToUser('u1')
  expect(getDraft('a')?.text).toBe('첫 사용자 초안')
  bindDraftsToUser('u2')
  expect(getDraft('a')).toBeUndefined()
  setDraft('a', { text: '둘째 사용자 초안', pending: [], discussion: false })
  bindDraftsToUser('u2')
  expect(getDraft('a')?.text).toBe('둘째 사용자 초안')
})
