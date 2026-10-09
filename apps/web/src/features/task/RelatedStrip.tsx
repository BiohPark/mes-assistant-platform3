import { useQuery } from '@tanstack/react-query'
import { Link2 } from 'lucide-react'
import { Link } from 'react-router'
import { tagKey, type Task } from '@mes/domain'
import { listTasks } from '@/api/tasks'
import { useAssistants } from '@/app/hooks'
import { AssistantAvatar } from '@/components/AssistantAvatar'
import { TaskStatusBadge } from '@/components/StatusBadges'
import { TagChip } from '@/components/TagChip'
import { useT } from '@/i18n'

/** 같은 태그를 직접 공유하는 다른 대화. 태그를 떼면 목록에서 사라진다. */
export function RelatedStrip({ task }: { task: Task }) {
  const assistants = useAssistants()
  const t = useT()
  const related = useQuery({ queryKey: ['tasks', 'related', task.tags], queryFn: async () => {
    const pages = await Promise.all(task.tags.map((tag) => listTasks({ tags: [tag] })))
    return [...new Map(pages.flat().map((item) => [item.id, item])).values()].sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))
  }, enabled: task.tags.length > 0 })
  const ownTags = new Set(task.tags.map(tagKey))
  const rows = (related.data ?? []).filter((item) => item.id !== task.id).map((item) => ({
    task: item,
    assistant: assistants.find((assistant) => assistant.id === item.assistantId),
    viaTags: item.tags.filter((tag) => ownTags.has(tagKey(tag))),
  })).filter((item) => item.viaTags.length > 0)
  if (rows.length === 0) return null
  return <details className="relative inline-block">
    <summary className="inline-flex h-6 cursor-pointer items-center gap-1 rounded-full border px-2 text-xs text-muted-foreground hover:bg-muted"><Link2 className="size-3" />{t('task.related.linked', { count: rows.length })}<span className="ml-0.5 flex -space-x-1">{rows.slice(0, 3).map((row) => row.assistant && <AssistantAvatar key={row.task.id} assistant={row.assistant} size="xs" singleInitial className="size-5 rounded-full text-xs ring-2 ring-background" />)}</span>{rows.length > 3 && <span className="text-xs">{t('task.related.more', { count: rows.length - 3 })}</span>}</summary>
    <div className="fixed inset-x-4 z-20 mt-1 w-auto sm:absolute sm:inset-x-auto sm:left-0 sm:w-[22rem] rounded-xl border bg-popover p-1 shadow-md"><div className="px-2 py-1 text-xs text-muted-foreground">{t('task.related.sameTag')}</div><ul className="max-h-72 overflow-y-auto">{rows.map(({ task: item, assistant, viaTags }) => <li key={item.id}><Link to={`/c/${item.id}`} className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-muted">{assistant && <AssistantAvatar assistant={assistant} size="xs" className="mt-0.5" />}<div className="min-w-0 flex-1"><div className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="font-mono">{item.code}</span><span className="truncate">{assistant?.name}</span><TaskStatusBadge status={item.status} className="ml-auto" /></div><div className="truncate text-xs font-medium">{item.title}</div><div className="mt-0.5 flex flex-wrap gap-1">{viaTags.map((tag) => <TagChip key={tag} tag={tag} size="xs" />)}</div></div></Link></li>)}</ul></div>
  </details>
}
