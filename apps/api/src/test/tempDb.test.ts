import { afterEach, expect, it, vi } from 'vitest'
import { createPool } from '../db/connection.js'
import { createTempDb } from './tempDb.js'

vi.mock('../db/connection.js', () => ({ createPool: vi.fn() }))

const originalUrl = process.env.DATABASE_URL
afterEach(() => {
  if (originalUrl === undefined) delete process.env.DATABASE_URL
  else process.env.DATABASE_URL = originalUrl
  vi.clearAllMocks()
})

it('closes the admin pool when creating a temporary DB fails', async () => {
  process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/test'
  const failure = new Error('create database denied')
  const query = vi.fn().mockRejectedValue(failure)
  const end = vi.fn().mockResolvedValue(undefined)
  vi.mocked(createPool).mockReturnValue({ query, end } as never)

  await expect(createTempDb('denied')).rejects.toBe(failure)
  expect(end).toHaveBeenCalledOnce()
})
