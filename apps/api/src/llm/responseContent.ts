import { inArray } from 'drizzle-orm'
import type { Message } from '@mes/domain'
import type { Db } from '../db/db.module.js'
import { message } from '../db/schema.js'

/** Display URLs belong to storage only. Every AI caller uses the unchanged response text. */
export const aiMessageContent = (row: { content: string; originalContent?: string | null }): string => row.originalContent ?? row.content

/** Preview/domain messages deliberately omit the private originalContent column. */
export async function messagesForAi(db: Db, messages: Message[]): Promise<Message[]> {
  if (!messages.length) return []
  const rows = await db.select({ id: message.id, originalContent: message.originalContent }).from(message).where(inArray(message.id, messages.map(item => item.id)))
  const originals = new Map(rows.map(row => [row.id, row.originalContent]))
  return messages.map(item => ({ ...item, content: aiMessageContent({ ...item, originalContent: originals.get(item.id) }) }))
}
