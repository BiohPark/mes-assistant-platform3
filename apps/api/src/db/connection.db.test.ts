import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPool } from './connection.js'
import { runMigrations } from './migrate.js'
import { createTempDb } from '../test/tempDb.js'

describe('MariaDB 연결 계약', () => {
  let temp: Awaited<ReturnType<typeof createTempDb>>
  let pool: ReturnType<typeof createPool>

  beforeAll(async () => {
    temp = await createTempDb('connection')
    pool = createPool(temp.url)
  })
  afterAll(async () => { await pool?.end(); await temp?.drop() })

  it('모든 연결에 UTC·READ COMMITTED·엄격 모드를 적용한다', async () => {
    const connections = await Promise.all([pool.getConnection(), pool.getConnection()])
    try {
      for (const connection of connections) {
        const [rows] = await connection.query('select @@session.time_zone as zone, @@session.tx_isolation as isolation_level, @@session.sql_mode as mode')
        const row = (rows as { zone: string; isolation_level: string; mode: string }[])[0]!
        expect(row.zone).toBe('+00:00')
        expect(row.isolation_level).toBe('READ-COMMITTED')
        expect(row.mode).toContain('STRICT_TRANS_TABLES')
      }
    } finally { connections.forEach((connection) => connection.release()) }
  })

  it('같은 값으로 갱신해도 맞은 행 한 건으로 판정한다', async () => {
    const connection = await pool.getConnection()
    try {
      await connection.query('create table matched_row_test (id int primary key, value int not null)')
      await connection.query('insert into matched_row_test values (1, 7)')
      const [result] = await connection.query('update matched_row_test set value = 7 where id = 1')
      expect((result as { affectedRows: number }).affectedRows).toBe(1)
    } finally { connection.release() }
  })

  it('세션 설정 실패 연결에서는 요청 쿼리를 실행하지 않는다', async () => {
    const broken = createPool(temp.url, 1)
    broken.pool.once('connection', (connection) => {
      const query = connection.query.bind(connection)
      connection.query = ((statement: string, ...args: unknown[]) =>
        query(statement.includes('sql_mode') ? "set session sql_mode = 'invalid-mode'" : statement, ...args)) as typeof connection.query
    })
    try {
      await expect(broken.query('create table must_not_exist (id int)')).rejects.toThrow()
      const [rows] = await pool.query("select count(*) as n from information_schema.tables where table_schema = database() and table_name = 'must_not_exist'")
      expect((rows as { n: number }[])[0]?.n).toBe(0)
    } finally { await broken.end() }
  })

  it('마이그레이션은 nopad 정렬이 아닌 DB를 거부한다', async () => {
    await pool.query('alter database character set utf8mb4 collate utf8mb4_general_ci')
    try {
      await expect(runMigrations(temp.url)).rejects.toThrow(/utf8mb4_nopad_bin/)
    } finally {
      await pool.query('alter database character set utf8mb4 collate utf8mb4_nopad_bin')
    }
  })
})
