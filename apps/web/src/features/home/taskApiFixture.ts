import type { Task, TaskSummary } from '@mes/domain'

/** HTTP-shaped test fixture: filtering is server-side and summaries have no detail arrays. */
export function taskApiFixture(url: string, tasks: Array<Task | TaskSummary>, userId = 'u'): Response {
  const parsed = new URL(url, 'https://test')
  const p = parsed.searchParams
  const ai = p.getAll('ai[]')
  const q = p.get('q')?.toLowerCase()
  const rows = tasks.filter(task => (!p.get('assistantId') || task.assistantId === p.get('assistantId'))
    && (!p.getAll('status[]').length || p.getAll('status[]').includes(task.status))
    && (!p.has('mine') || task.ownerId === userId || task.assigneeIds.includes(userId))
    && (!q || `${task.code} ${task.title} ${(task.tags ?? []).join(' ')} ${(task.linkedSrCodes ?? []).join(' ')}`.toLowerCase().includes(q))
    && p.getAll('tag[]').every(tag => (task.tags ?? []).includes(tag))
    && (!ai.length || ai.some(value => value === 'responding' ? ['pending', 'streaming'].includes(task.aiRequest?.status ?? '') : value === 'failed' ? ['failed', 'interrupted'].includes(task.aiRequest?.status ?? '') : task.aiRequest?.status === value)))
    .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))
    .map(task => {
      if ('inputCount' in task) return task
      const { inputs, outputFileIds, checklist, summary: _summary, ...rest } = task
      return { ...rest, inputCount: (inputs ?? []).length, outputCount: (outputFileIds ?? []).length, checklist: { checked: (checklist ?? []).filter(item => item.checked).length, total: (checklist ?? []).length } }
    })
  const limit = Number(p.get('limit') ?? 30)
  const offset = Number(p.get('cursor') ?? 0)
  if (parsed.pathname.endsWith('/board')) {
    return Response.json({ columns: [...new Set(rows.map(task => task.assistantId))].map(assistantId => {
      const column = rows.filter(task => task.assistantId === assistantId)
      return { assistantId, total: column.length, items: column.slice(0, limit), nextCursor: column.length > limit ? String(limit) : null }
    }) })
  }
  return Response.json(rows.slice(offset, offset + limit), { headers: offset + limit < rows.length ? { 'X-Next-Cursor': String(offset + limit) } : {} })
}
