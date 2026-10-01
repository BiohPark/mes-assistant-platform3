import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Task } from '@mes/domain'
import { addNote, deleteNote, getNotes } from '@/api/tasks'
import { filesForTask, getCandidates } from '@/api/files'
import { useCurrentUserId, useUserMap } from '@/app/hooks'
import { useMe } from '@/app/auth'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { formatDateTime } from '@/lib/dates'

export function NotesPanel({ task }: { task: Task }) {
  const users = useUserMap()
  const me = useCurrentUserId()
  const isSystemOwner = useMe().roles.includes('system_owner')
  const notes = useQuery({ queryKey: ['notes', task.id], queryFn: () => getNotes(task.id) })
  const own = useQuery({ queryKey: ['files', task.id], queryFn: () => filesForTask(task.id) })
  const candidates = useQuery({ queryKey: ['candidates', task.id], queryFn: () => getCandidates(task.id) })
  const files = [...new Map([...(own.data ?? []), ...(candidates.data?.files ?? []).map((item) => item.file)].map((file) => [file.id, file])).values()]
  const [content, setContent] = useState('')
  const [attachmentIds, setAttachmentIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  async function save() {
    setBusy(true)
    try { await addNote(task.id, content, attachmentIds); setContent(''); setAttachmentIds([]) }
    catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  return <section className="space-y-3 text-xs" data-testid="notes-panel">
    <h3 className="font-semibold">노트</h3>
    {notes.isError && <div role="alert">노트를 불러오지 못했습니다. <button className="underline" onClick={() => void notes.refetch()}>다시 시도</button></div>}
    {(notes.data ?? []).map((item) => <article key={item.id} className="rounded border p-2">
      <div className="flex justify-between text-[10px] text-muted-foreground"><span>{users.get(item.authorId)?.name ?? item.authorId} · {formatDateTime(item.createdAt)}</span>
        {task.status !== 'done' && (item.authorId === me || isSystemOwner) && <button type="button" className="underline" onClick={() => void deleteNote(task.id, item.id).catch((error: unknown) => toast.error(String(error)))}>삭제</button>}
      </div>
      <p className="mt-1 whitespace-pre-wrap">{item.content}</p>
      {!!item.attachmentIds.length && <ul className="mt-1 text-muted-foreground">{item.attachmentIds.map((fileId) => <li key={fileId}>{files.find((file) => file.id === fileId)?.name ?? fileId}</li>)}</ul>}
    </article>)}
    {task.status !== 'done' && <div className="space-y-2 rounded border p-2">
      <Textarea aria-label="노트 본문" value={content} onChange={(event) => setContent(event.target.value)} rows={3} placeholder="노트 작성" className="text-xs" />
      {!!files.length && <fieldset><legend className="mb-1 text-muted-foreground">자료함 파일 첨부</legend><div className="max-h-24 space-y-1 overflow-y-auto">{files.map((file) => <label key={file.id} className="flex items-center gap-1"><input type="checkbox" checked={attachmentIds.includes(file.id)} onChange={(event) => setAttachmentIds(event.target.checked ? [...attachmentIds, file.id] : attachmentIds.filter((id) => id !== file.id))} />{file.name} v{file.version}</label>)}</div></fieldset>}
      <Button size="xs" disabled={busy || (!content.trim() && !attachmentIds.length)} onClick={() => void save()}>노트 추가</Button>
    </div>}
  </section>
}
