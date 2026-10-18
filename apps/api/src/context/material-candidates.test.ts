import { expect, it, vi } from 'vitest'
import { MySqlDialect } from 'drizzle-orm/mysql-core'
import type { SQL } from 'drizzle-orm'
import { ForbiddenException, NotFoundException } from '@nestjs/common'
import type { Db } from '../db/db.module.js'
import { DbTasksService } from '../tasks/tasks.service.js'

it('returns only a count in one bounded aggregate query without projecting SR bodies, messages or steps', async () => {
  const execute = vi.fn(async (_query: SQL) => [[{ count: '250', can_read: 1 }], []])
  const db = { execute } as unknown as Db
  const result = await new DbTasksService(db).candidateCount('actor', 'target')
  expect(result).toEqual({ count: 250 })
  expect(execute).toHaveBeenCalledTimes(1)
  const dialect = new MySqlDialect()
  const query = dialect.sqlToQuery(execute.mock.calls[0]![0] as never)
  expect(query.params).toContain('actor')
  expect(query.params).toContain('target')
  // ACCESSIBLE is reserved in MariaDB; an unquoted alias makes the real endpoint return 500.
  expect(query.sql).not.toMatch(/\bas\s+accessible\b/i)
  expect(query.sql).not.toMatch(/(?:select|,)\s*(?:`?\w+`?\.)?`?(?:body|content|steps|reasoning)`?\b/i)
})
it.each([{ rows: [] }, { rows: [{ count: 0, can_read: 0 }] }])('enforces target existence and access before returning a count (%j)', async ({ rows }) => {
  const db = { execute: async () => [rows, []] } as unknown as Db
  await expect(new DbTasksService(db).candidateCount('actor', 'target')).rejects.toBeInstanceOf(rows.length ? ForbiddenException : NotFoundException)
})
