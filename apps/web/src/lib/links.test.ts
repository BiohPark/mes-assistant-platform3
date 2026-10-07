import { describe, it, expect } from 'vitest'
import { assistantExternalUrl, assistantLink1, openWebUiBase } from './links'

describe('openWebUiBase', () => {
  it('strips trailing /api', () => {
    expect(openWebUiBase('http://openwebui.internal/api')).toBe('http://openwebui.internal')
    expect(openWebUiBase('http://openwebui.internal/api/')).toBe('http://openwebui.internal')
  })
  it('keeps non-api base', () => {
    expect(openWebUiBase('http://llm.internal:8000/v1')).toBe('http://llm.internal:8000/v1')
  })
})

describe('assistantExternalUrl', () => {
  it('builds ?model= link', () => {
    expect(assistantExternalUrl('http://openwebui.internal/api', 'et-urs-assistant')).toBe('http://openwebui.internal/?model=et-urs-assistant')
  })
  it('encodes model id', () => {
    expect(assistantExternalUrl('http://x/api', 'a b')).toBe('http://x/?model=a%20b')
  })
})

describe('assistantLink1', () => {
  it('전역 규칙에 모델 ID를 인코딩해 넣고 직접 지정한 주소를 우선한다', () => {
    const assistant = { id: 'agent', modelId: 'model A' }
    expect(assistantLink1('', assistant, 'https://example.test/?model={modelId}&assistant={assistantId}')).toBe('https://example.test/?model=model%20A&assistant=agent')
    expect(assistantLink1('', { ...assistant, link1: 'https://direct.test/' }, 'https://example.test/')).toBe('https://direct.test/')
  })
})


it('내부 ID만 있으면 설정 규칙이 있어도 링크를 만들지 않는다', () => {
  expect(assistantLink1('https://owui.test/api', { id: 'internal' })).toBeUndefined()
  expect(assistantLink1('https://owui.test/api', { id: 'internal' }, 'https://owui.test/?assistant={assistantId}')).toBeUndefined()
})

it('모델은 직접 링크·설정 규칙·기본 주소 순으로 사용하고 빈 기본 주소는 숨긴다', () => {
  expect(assistantLink1('', { id: 'internal', link1: 'https://direct.test' })).toBe('https://direct.test')
  expect(assistantLink1('', { id: 'internal', modelId: 'mapped' })).toBeUndefined()
  expect(assistantLink1('https://owui.test/api', { id: 'internal', modelId: 'mapped' })).toBe('https://owui.test/?model=mapped')
  expect(assistantLink1('', { id: 'legacy agent', modelId: 'mapped' }, 'https://owui.test/?agent={assistantId}')).toBe('https://owui.test/?agent=legacy%20agent')
})
