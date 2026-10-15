import { beforeEach, expect, it } from 'vitest'
import { bindHistory, clearConversation, greet, HISTORY_KEY, mirrorChat, recordNotice, resetHistory, restoreHistory, say, useAssistantHistory } from './history'

const state = () => useAssistantHistory.getState()
const stored = () => JSON.parse(sessionStorage.getItem(HISTORY_KEY) ?? 'null') as { userId: string; log: unknown[]; notices: unknown[] } | null
beforeEach(() => resetHistory())

it('도우미 이력은 sessionStorage에 남아 새로고침(다시 읽기) 뒤에도 같은 사용자에게 돌아온다 — 다른 사용자가 들어오면 비운다', () => {
  bindHistory('u1')
  say('user', 'pill.log.askGuide')
  recordNotice({ key: 'load-1', source: 'reply.done', taskId: 't1', title: '검사' })
  expect(stored()).toMatchObject({ userId: 'u1', log: [{ kind: 'line', who: 'user', text: 'pill.log.askGuide' }], notices: [{ source: 'reply.done', taskId: 't1', title: '검사' }] })
  const saved = sessionStorage.getItem(HISTORY_KEY)!
  useAssistantHistory.setState({ userId: '', log: [], notices: [], greeted: [] }) // 새 페이지 로드 흉내 — 메모리는 비고 저장본만 남는다
  sessionStorage.setItem(HISTORY_KEY, saved)
  restoreHistory()
  bindHistory('u1')
  expect(state().log).toHaveLength(1)
  expect(state().notices).toHaveLength(1)
  bindHistory('u2')
  expect(state().log).toEqual([])
  expect(state().notices).toEqual([])
  expect(stored()?.userId).toBe('u2')
})

it('묶기 전에 남긴 줄은 처음 묶는 사용자의 것이다', () => {
  say('helper', 'pill.log.guideStop')
  bindHistory('u1')
  expect(state().log).toHaveLength(1)
})

it('인사는 페이지마다 세션에 한 번 — 다시 불러도 늘지 않는다', () => {
  greet('hub'); greet('hub'); greet('sr')
  expect(state().log.map(entry => entry.kind === 'greet' && entry.route)).toEqual(['hub', 'sr'])
  clearConversation()
  greet('hub')
  expect(state().log).toEqual([]) // 지워도 이번 세션에는 다시 인사하지 않는다
})

it('도우미와 직접 나눈 대화를 그대로 비춘다 — 같은 id는 내용만 바꾸고, 기다리는 중인 답은 끝나면 남긴다. 지우기는 대화만 비우고 알림은 둔다', () => {
  mirrorChat([{ id: 'm1', role: 'user', content: '안녕' }, { id: 'm2', role: 'assistant', content: '', waiting: true }])
  expect(state().log).toEqual([{ id: 'm1', kind: 'chat', role: 'user', content: '안녕' }])
  mirrorChat([{ id: 'm1', role: 'user', content: '안녕' }, { id: 'm2', role: 'assistant', content: '반가워요' }])
  mirrorChat([{ id: 'm1', role: 'user', content: '안녕' }, { id: 'm2', role: 'assistant', content: '반가워요' }])
  expect(state().log.map(entry => entry.kind === 'chat' && entry.content)).toEqual(['안녕', '반가워요'])
  recordNotice({ key: 'load-2', source: 'guide.done' })
  clearConversation()
  expect(state().log).toEqual([])
  expect(state().notices).toHaveLength(1)
})

it('알림은 말풍선 하나에 한 번만(StrictMode 재실행), 최근 50개·대화는 최근 60줄만 남긴다', () => {
  recordNotice({ key: 'a', source: 'guide.done' })
  recordNotice({ key: 'a', source: 'guide.done' })
  expect(state().notices).toHaveLength(1)
  for (let index = 0; index < 60; index++) recordNotice({ key: `n${index}`, source: 'share.none' })
  expect(state().notices).toHaveLength(50)
  for (let index = 0; index < 70; index++) say('user', 'pill.log.askGuide')
  expect(state().log).toHaveLength(60)
})

it('저장이 막혀도 이번 화면에서는 이력이 쌓인다', () => {
  const original = Storage.prototype.setItem
  Storage.prototype.setItem = () => { throw new Error('blocked') }
  try {
    say('user', 'pill.log.askGuide')
    expect(state().log).toHaveLength(1)
  } finally { Storage.prototype.setItem = original }
})
