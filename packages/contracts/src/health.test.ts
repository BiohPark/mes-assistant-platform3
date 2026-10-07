import { describe, expect, it } from 'vitest'
import { HealthSchema } from './health.js'

describe('health contract', () => {
  it('상태와 DB 연결 및 배포 버전을 담는다', () => {
    expect(HealthSchema.parse({ status: 'ok', db: 'up', version: '0.1.0', commit: 'abc123' })).toEqual({ status: 'ok', db: 'up', version: '0.1.0', commit: 'abc123' })
    expect(HealthSchema.safeParse({ status: 'ok' }).success).toBe(false)
    expect(HealthSchema.safeParse({ status: 'ok', db: 'up' }).success).toBe(false)
  })
})
