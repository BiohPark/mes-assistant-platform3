import { pathToFileURL } from 'node:url'
import { drizzle } from 'drizzle-orm/mysql2'
import { eq } from 'drizzle-orm'
import type { Db } from './db.module.js'
import { createPool } from './connection.js'
import { seedCatalog } from './seed.js'
import { activityLog, assistant, fileObject, message, serviceRequest, tag, task, taskTag, thread } from './schema.js'

export async function seedScale(db: Db, size = { tasks: 1000, files: 10000, srs: 1000 }): Promise<void> {
  if (![size.tasks, size.files, size.srs].every((n) => Number.isInteger(n) && n > 0)) throw new Error('시드 수량은 양수여야 합니다')
  await seedCatalog(db)
  if ((await db.select({ id: task.id }).from(task).where(eq(task.id, 'scale-task-1')).limit(1)).length) throw new Error('규모 시드가 이미 있습니다')
  const [agent] = await db.select({ id: assistant.id }).from(assistant).limit(1)
  if (!agent) throw new Error('시드 에이전트가 없습니다')
  await db.insert(tag).values({ key: 'scale', label: 'scale', kind: 'keyword' })
  const now = new Date()
  for (let offset = 0; offset < size.tasks; offset += 100) {
    const range = Array.from({ length: Math.min(100, size.tasks - offset) }, (_, i) => offset + i + 1)
    await db.insert(task).values(range.map((n) => ({ id: `scale-task-${n}`, code: `WK-2099-${String(n).padStart(4, '0')}`, assistantId: agent.id,
      title: `규모 업무 ${n}`, titleSource: 'default', status: n % 4 === 0 ? 'done' : 'in_progress', ownerId: 'seed-system', priority: 'normal',
      createdBy: 'seed-system', startedAt: now, ...(n % 4 === 0 ? { completedAt: now } : {}) })))
    await db.insert(thread).values(range.map((n) => ({ id: `scale-thread-${n}`, taskId: `scale-task-${n}`, title: `규모 업무 ${n}`, createdBy: 'seed-system' })))
    await db.insert(taskTag).values(range.map((n) => ({ taskId: `scale-task-${n}`, tagKey: 'scale', addedBy: 'seed-system' })))
    await db.insert(message).values(range.flatMap((n) => [
      { id: `scale-message-${n}-1`, threadId: `scale-thread-${n}`, seq: 1, role: 'user', content: '규모 측정 입력', status: 'done', authorId: 'seed-system' },
      { id: `scale-message-${n}-2`, threadId: `scale-thread-${n}`, seq: 2, role: 'assistant', content: '규모 측정 응답', status: 'done' },
    ]))
    await db.insert(activityLog).values(range.map((n) => ({ id: `scale-activity-${n}`, taskId: `scale-task-${n}`, userId: 'seed-system',
      type: n % 4 === 0 ? 'task.completed' : 'task.created', payload: { seed: true }, at: now })))
  }
  for (let offset = 0; offset < size.files; offset += 200) {
    const range = Array.from({ length: Math.min(200, size.files - offset) }, (_, i) => offset + i + 1)
    await db.insert(fileObject).values(range.map((n) => ({ id: `scale-file-${n}`, kind: 'task_file', originTaskId: `scale-task-${(n - 1) % size.tasks + 1}`,
      originalName: `scale-${n}.txt`, mime: 'text/plain', sizeBytes: 5, sha256: '0'.repeat(64), storageKey: `scale/${n}.txt`,
      source: 'upload', version: 1, uploadedBy: 'seed-system' })))
  }
  for (let offset = 0; offset < size.srs; offset += 100) {
    const range = Array.from({ length: Math.min(100, size.srs - offset) }, (_, i) => offset + i + 1)
    await db.insert(serviceRequest).values(range.map((n) => ({ id: `scale-sr-${n}`, code: `SR-2099-${String(n).padStart(4, '0')}`,
      requesterId: 'seed-system', title: `규모 요청 ${n}`, titleSource: 'manual', body: '규모 측정', status: 'submitted', submittedAt: now })))
    await db.insert(activityLog).values(range.map((n) => ({ id: `scale-sr-activity-${n}`, srId: `scale-sr-${n}`, userId: 'seed-system',
      type: 'sr.submitted', payload: { seed: true }, at: now })))
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.env.NODE_ENV === 'production') {
    process.stderr.write('운영 환경에서는 규모 시드를 실행할 수 없습니다.\n')
    process.exitCode = 1
  } else if (!process.env.DATABASE_URL) {
    process.stderr.write('DATABASE_URL이 없습니다.\n')
    process.exitCode = 1
  } else {
    const client = createPool(process.env.DATABASE_URL)
    try { await seedScale(drizzle(client)) }
    finally { await client.end() }
  }
}
