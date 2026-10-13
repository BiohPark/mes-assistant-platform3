import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link2 } from 'lucide-react'
import { Link } from 'react-router'
import { tagKey } from '@mes/domain'
import { listTasks } from '@/api/tasks'
import { useAssistants } from '@/app/hooks'
import { AssistantAvatar } from '@/components/AssistantAvatar'
import { TaskStatusBadge } from '@/components/StatusBadges'
import { TagChip } from '@/components/TagChip'
import { useT } from '@/i18n'
import { ComposeBar, ComposeRow, useCompose } from './RelatedStripCompose'

const pill = 'inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs text-muted-foreground'

/**
 * 같은 태그를 직접 공유하는 다른 대화 — 태그별로 묶어 보여 준다(두 태그를 공유하면 두 묶음에 모두). 태그를 떼면 사라진다.
 * 초안(대화 생성 전)에서도 tags만으로 조회한다 — 조회만 하고 저장하지 않으며, 열람 범위는 서버 목록 API가 적용한다.
 * 0건·로딩·오류를 구분해 표시한다.
 * 대화 안(excludeTaskId = 이 대화)에서는 행마다 대화 본문·파일 버전을 골라 이 대화의 요청 자료로 담을 수 있다 — 초안은 링크만.
 */
export function RelatedStrip({ tags, excludeTaskId }: { tags: string[]; excludeTaskId?: string }) {
  const assistants = useAssistants()
  const t = useT()
  const [open, setOpen] = useState(false)
  const compose = useCompose(excludeTaskId, open)
  const related = useQuery({ queryKey: ['tasks', 'related', tags], queryFn: async () => {
    const pages = await Promise.all(tags.map((tag) => listTasks({ tags: [tag] })))
    return [...new Map(pages.flat().map((item) => [item.id, item])).values()].sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))
  }, enabled: tags.length > 0 })
  if (tags.length === 0) return null
  if (related.isError) return <span role="alert" className={pill}><Link2 className="size-3" />{t('task.related.loadFailed')}<button type="button" className="underline" onClick={() => void related.refetch()}>{t('task.related.retry')}</button></span>
  // 태그가 바뀐 직후(새 쿼리 키)는 이전 결과를 쓰지 않는다 — 이전 데이터를 새 태그로 걸러 '없음'이 뜨는 오표시 방지
  if (!related.data) return <span className={pill} aria-busy="true"><Link2 className="size-3" />{t('task.related.loading')}</span>
  const ownTags = new Set(tags.map(tagKey))
  const rows = related.data.filter((item) => item.id !== excludeTaskId).map((item) => ({
    task: item,
    assistant: assistants.find((assistant) => assistant.id === item.assistantId),
    viaTags: item.tags.filter((tag) => ownTags.has(tagKey(tag))),
  })).filter((item) => item.viaTags.length > 0)
  if (rows.length === 0) return <span className={pill}><Link2 className="size-3" />{t('task.related.none')}</span>
  const groups = tags.map((tag) => ({ tag, rows: rows.filter((row) => row.viaTags.some((via) => tagKey(via) === tagKey(tag))) })).filter((group) => group.rows.length > 0)
  return <details className="relative inline-block" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="inline-flex h-6 cursor-pointer items-center gap-1 rounded-full border px-2 text-xs text-muted-foreground hover:bg-muted"><Link2 className="size-3" />{t('task.related.linked', { count: rows.length })}<span className="ml-0.5 flex -space-x-1">{rows.slice(0, 3).map((row) => row.assistant && <AssistantAvatar key={row.task.id} assistant={row.assistant} size="xs" singleInitial className="size-5 rounded-full text-xs ring-2 ring-background" />)}</span>{rows.length > 3 && <span className="text-xs">{t('task.related.more', { count: rows.length - 3 })}</span>}</summary>
    <div className="fixed inset-x-4 z-20 mt-1 w-auto sm:absolute sm:inset-x-auto sm:left-0 sm:w-[22rem] rounded-xl border bg-popover p-1 shadow-md"><div className="px-2 py-1 text-xs text-muted-foreground">{t('task.related.sameTag')}</div><ul className="max-h-72 overflow-y-auto">{groups.map((group) => <li key={group.tag}>
      <div className="flex items-center gap-1.5 px-2 pt-1.5 pb-0.5"><TagChip tag={group.tag} size="xs" /><span className="text-xs text-muted-foreground">{group.rows.length}</span></div>
      <ul>{group.rows.map(({ task: item, assistant }) => <li key={item.id}><Link to={`/c/${item.id}`} className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-muted">{assistant && <AssistantAvatar assistant={assistant} size="xs" className="mt-0.5" />}<div className="min-w-0 flex-1"><div className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="font-mono">{item.code}</span><span className="truncate">{assistant?.name}</span><TaskStatusBadge status={item.status} className="ml-auto" /></div><div className="truncate text-xs font-medium">{item.title}</div></div></Link>
        {excludeTaskId && <ComposeRow taskId={item.id} code={item.code} compose={compose} />}</li>)}</ul>
    </li>)}</ul>{excludeTaskId && <ComposeBar compose={compose} />}</div>
  </details>
}
