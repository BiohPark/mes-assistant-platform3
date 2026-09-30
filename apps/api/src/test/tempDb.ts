import { randomUUID } from 'node:crypto'
import { createPool } from '../db/connection.js'

/** DATABASE_URL 서버에 임시 DB를 만들고 연결 URL을 돌려준다. drop()으로 정리. */
export async function createTempDb(label: string) {
  const base = process.env.DATABASE_URL
  if (!base) throw new Error('DATABASE_URL이 없습니다 — docker compose up 후 .env를 준비하세요')
  const name = `t_${label}_${randomUUID().replaceAll('-', '').slice(0, 12)}`
  const admin = createPool(base, 1)
  await admin.query(`create database \`${name}\` character set utf8mb4 collate utf8mb4_nopad_bin`)
  const url = new URL(base)
  url.pathname = `/${name}`
  return {
    url: url.toString(),
    async drop() {
      await admin.query(`drop database if exists \`${name}\``)
      await admin.end()
    },
  }
}
