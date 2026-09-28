import { describe, it, expect } from 'vitest'
import { assistantExternalUrl, openWebUiBase } from './links'

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
