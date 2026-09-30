import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { drizzle } from 'drizzle-orm/mysql2'
import { migrate } from 'drizzle-orm/mysql2/migrator'
import { createPool } from './connection.js'

/** drizzle/ 마이그레이션을 적용한다 (src·dist 어디서 불러도 apps/api/drizzle을 가리킨다) */
export async function runMigrations(databaseUrl: string) {
  const client = createPool(databaseUrl, 1)
  try {
    const [rows] = await client.query('select default_character_set_name as charset, default_collation_name as collation from information_schema.schemata where schema_name = database()')
    const current = (rows as { charset: string; collation: string }[])[0]
    if (current?.charset !== 'utf8mb4' || current.collation !== 'utf8mb4_nopad_bin') {
      throw new Error(`DB 문자셋/정렬은 utf8mb4/utf8mb4_nopad_bin이어야 합니다 (현재 ${current?.charset}/${current?.collation})`)
    }
    await migrate(drizzle(client), { migrationsFolder: resolve(import.meta.dirname, '../../drizzle') })
  } finally {
    await client.end()
  }
}

// `pnpm db:migrate` — node dist/db/migrate.js
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL이 필요합니다')
  await runMigrations(url)
  console.log('마이그레이션 적용 완료')
}
