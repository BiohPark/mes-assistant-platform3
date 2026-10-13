import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { Db } from '../db/db.module.js'
import { activityLog, task } from '../db/schema.js'

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

/** Call only after locking the task row and accepting a new send, within the same transaction. */
export async function resumeHeldTask(tx: Tx, owner: typeof task.$inferSelect | undefined, actor: string): Promise<boolean> {
  if (owner?.status !== 'on_hold') return false
  await tx.update(task).set({ status: 'in_progress', startedAt: owner.startedAt ?? new Date(), lastActivityAt: new Date() }).where(eq(task.id, owner.id))
  await tx.insert(activityLog).values({ id: randomUUID(), type: 'task.started', taskId: owner.id, assistantId: owner.assistantId,
    userId: actor, payload: { from: 'on_hold', to: 'in_progress', auto: true } })
  return true
}
