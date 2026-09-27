import { describe, expect, it } from 'vitest'
import { HealthSchema } from './health.js'

describe('health contract', () => {
  it('상태와 DB 연결 여부를 담는다', () => {
    expect(HealthSchema.parse({ status: 'ok', db: 'up' })).toEqual({ status: 'ok', db: 'up' })
    expect(HealthSchema.safeParse({ status: 'ok' }).success).toBe(false)
  })
})
