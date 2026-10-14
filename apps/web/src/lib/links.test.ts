import { describe, it, expect } from 'vitest'
import { assistantExternalUrl, assistantLink1, openWebUiBase, withModelParam } from './links'

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

describe('withModelParam', () => {
  it('쿼리가 없으면 ?model=, 있으면 &model=로 붙이고 조각(#)은 뒤에 둔다', () => {
    expect(withModelParam('https://owui.test/', 'm 1')).toBe('https://owui.test/?model=m%201')
    expect(withModelParam('https://owui.test/?lang=ko', 'm')).toBe('https://owui.test/?lang=ko&model=m')
    expect(withModelParam('https://owui.test/#chat', 'm')).toBe('https://owui.test/?model=m#chat')
  })
  it('이미 model= 쿼리가 있으면 그대로 둔다', () => {
    expect(withModelParam('https://owui.test/?model=other', 'm')).toBe('https://owui.test/?model=other')
    expect(withModelParam('https://owui.test/?a=1&model=other', 'm')).toBe('https://owui.test/?a=1&model=other')
  })
})

describe('assistantLink1', () => {
  it('전역 규칙에 {modelId}가 있으면 그 자리에 넣고 {assistantId}도 치환한다', () => {
    const assistant = { id: 'agent', modelId: 'model A' }
    expect(assistantLink1('', assistant, 'https://example.test/?model={modelId}&assistant={assistantId}')).toBe('https://example.test/?model=model%20A&assistant=agent')
  })
  it('{modelId}가 없는 규칙은 OpenWebUI 주소로 보고 ?model=·&model=을 붙인다', () => {
    const assistant = { id: 'agent', modelId: 'mapped' }
    expect(assistantLink1('', assistant, 'https://owui.test/')).toBe('https://owui.test/?model=mapped')
    expect(assistantLink1('', assistant, 'https://owui.test/?lang=ko')).toBe('https://owui.test/?lang=ko&model=mapped')
    expect(assistantLink1('', { id: 'legacy agent', modelId: 'mapped' }, 'https://owui.test/?agent={assistantId}')).toBe('https://owui.test/?agent=legacy%20agent&model=mapped')
  })
  it('에이전트별 link1은 규칙보다 우선하고 model= 이 없으면 같은 규칙으로 붙인다', () => {
    expect(assistantLink1('', { id: 'agent', modelId: 'model A', link1: 'https://direct.test/' }, 'https://example.test/')).toBe('https://direct.test/?model=model%20A')
    expect(assistantLink1('', { id: 'agent', modelId: 'm', link1: 'https://direct.test/?model=fixed' })).toBe('https://direct.test/?model=fixed')
    expect(assistantLink1('', { id: 'internal', link1: 'https://direct.test' })).toBe('https://direct.test')
  })
})

it('내부 ID만 있으면 설정 규칙이 있어도 링크를 만들지 않는다', () => {
  expect(assistantLink1('https://owui.test/api', { id: 'internal' })).toBeUndefined()
  expect(assistantLink1('https://owui.test/api', { id: 'internal' }, 'https://owui.test/?assistant={assistantId}')).toBeUndefined()
})

it('모델은 직접 링크·설정 규칙·기본 주소 순으로 사용하고 빈 기본 주소는 숨긴다', () => {
  expect(assistantLink1('', { id: 'internal', modelId: 'mapped' })).toBeUndefined()
  expect(assistantLink1('https://owui.test/api', { id: 'internal', modelId: 'mapped' })).toBe('https://owui.test/?model=mapped')
})
