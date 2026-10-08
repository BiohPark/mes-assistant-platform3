import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Task } from '@mes/domain'
import { addNote, deleteNote, getNotes } from '@/api/tasks'
import { filesForTask, getCandidates } from '@/api/files'
import { useCurrentUserId, useUserMap } from '@/app/hooks'
import { useMe } from '@/app/auth'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useDates } from '@/lib/dates'
import { useT } from '@/i18n'

export function NotesPanel({ task }: { task: Task }) {
  const { formatDateTime } = useDates()
  const users = useUserMap()
  const t = useT()
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
    <h3 className="font-semibold">{t('task.notes.title')}</h3>
    {notes.isError && <div role="alert">{t('task.notes.loadFailed')} <button className="underline" onClick={() => void notes.refetch()}>{t('common.retry')}</button></div>}
    {(notes.data ?? []).map((item) => <article key={item.id} className="rounded-xl border p-2">
      <div className="flex justify-between text-xs text-muted-foreground"><span>{users.get(item.authorId)?.name ?? item.authorId} · {formatDateTime(item.createdAt)}</span>
        {task.status !== 'done' && (item.authorId === me || isSystemOwner) && <button type="button" className="underline" onClick={() => void deleteNote(task.id, item.id).catch((error: unknown) => toast.error(String(error)))}>{t('task.delete')}</button>}
      </div>
      <p className="mt-1 whitespace-pre-wrap">{item.content}</p>
      {!!item.attachmentIds.length && <ul className="mt-1 text-muted-foreground">{item.attachmentIds.map((fileId) => <li key={fileId}>{files.find((file) => file.id === fileId)?.name ?? fileId}</li>)}</ul>}
    </article>)}
    {task.status !== 'done' && <div className="space-y-2 rounded-lg border p-2">
      <Textarea aria-label={t('task.notes.body')} value={content} onChange={(event) => setContent(event.target.value)} rows={3} placeholder={t('task.notes.placeholder')} className="text-xs" />
      {!!files.length && <fieldset><legend className="mb-1 text-muted-foreground">{t('task.notes.attach')}</legend><div className="max-h-24 space-y-1 overflow-y-auto">{files.map((file) => <div key={file.id} className="flex items-center gap-1.5"><Checkbox id={`note-attachment-${file.id}`} checked={attachmentIds.includes(file.id)} onCheckedChange={(checked) => setAttachmentIds(checked === true ? [...attachmentIds, file.id] : attachmentIds.filter((id) => id !== file.id))} /><Label htmlFor={`note-attachment-${file.id}`} className="text-xs font-normal">{file.name} v{file.version}</Label></div>)}</div></fieldset>}
      <Button size="xs" disabled={busy || (!content.trim() && !attachmentIds.length)} onClick={() => void save()}>{t('task.notes.add')}</Button>
    </div>}
  </section>
}
