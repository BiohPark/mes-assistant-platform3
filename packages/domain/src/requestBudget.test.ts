import { describe, expect, it } from 'vitest'
import { DEFAULT_REQUEST_BUDGET_BYTES, budgetLevel, byteLength, requestBytes } from './requestBudget.js'

describe('request budget', () => {
  it('measures UTF-8 bytes, not characters', () => {
    expect(byteLength('abc')).toBe(3)
    expect(byteLength('가')).toBe(3)
  })

  it('measures the serialized request body', () => {
    const body = { model: 'm', messages: [{ role: 'user', content: '가' }] }
    expect(requestBytes(body)).toBe(byteLength(JSON.stringify(body)))
  })

  it('classifies ok / warn (over 80%) / over', () => {
    expect(budgetLevel(100, 1000)).toBe('ok')
    expect(budgetLevel(801, 1000)).toBe('warn')
    expect(budgetLevel(1000, 1000)).toBe('warn')
    expect(budgetLevel(1001, 1000)).toBe('over')
  })

  it('defaults to 256 KiB', () => {
    expect(DEFAULT_REQUEST_BUDGET_BYTES).toBe(262144)
  })
})
