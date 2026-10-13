import type { Pool } from 'mysql2/promise'

/**
 * 마이그레이션 직후 상태로 되돌린다 — 앱 테이블 행을 모두 지우고 마이그레이션 이력(__drizzle_migrations)만 남긴다.
 * 테스트마다 임시 DB를 새로 만들고 마이그레이션하는 비용을 피하려고 쓴다(Windows CI의 MariaDB는 마이그레이션 1회 ≈ 20초).
 * 전제: 빈 DB에 마이그레이션해도 행이 생기지 않고, AUTO_INCREMENT·시퀀스·트리거가 없다(drizzle/*.sql 기준).
 */
export async function clearTables(pool: Pool) {
  const [tables] = await pool.query(`select table_name as name from information_schema.tables
    where table_schema = database() and table_type = 'BASE TABLE' and table_name <> '__drizzle_migrations'`)
  const connection = await pool.getConnection()
  try {
    await connection.query('set foreign_key_checks = 0')
    await connection.beginTransaction()
    for (const { name } of tables as { name: string }[]) await connection.query(`delete from \`${name}\``)
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    await connection.query('set foreign_key_checks = 1')
    connection.release()
  }
}
