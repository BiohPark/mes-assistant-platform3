import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

/** drizzle/ 마이그레이션을 적용한다 (src·dist 어디서 불러도 apps/api/drizzle을 가리킨다) */
export async function runMigrations(databaseUrl: string) {
  const client = postgres(databaseUrl, { max: 1, onnotice: () => undefined })
  try {
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
