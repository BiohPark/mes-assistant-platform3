import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { generateDrizzleJson, generateMigration, type DrizzleSnapshotJSON } from 'drizzle-kit/api'
import { describe, expect, it } from 'vitest'
import * as schema from './schema.js'

const meta = resolve(import.meta.dirname, '../../drizzle/meta')

function latestSnapshot(): DrizzleSnapshotJSON {
  const journal = JSON.parse(readFileSync(resolve(meta, '_journal.json'), 'utf8')) as { entries: { idx: number }[] }
  const last = journal.entries.at(-1)!
  return JSON.parse(readFileSync(resolve(meta, `${String(last.idx).padStart(4, '0')}_snapshot.json`), 'utf8'))
}

// schema-parity.db.test(초안 SQL ↔ 마이그레이션)와 짝: 여기서는 schema.ts ↔ 마이그레이션 (DB 없이)
describe('schema.ts ↔ drizzle 마이그레이션', () => {
  it('schema.ts를 바꿨다면 db:generate로 마이그레이션도 만들었다 (남은 변경 없음)', async () => {
    const current = generateDrizzleJson(schema as Record<string, unknown>)
    expect(await generateMigration(latestSnapshot(), current)).toEqual([])
  })
})
