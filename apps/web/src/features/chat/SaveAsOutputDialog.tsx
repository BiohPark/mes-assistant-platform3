import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Message, Task } from '@mes/domain'
import type { Assistant } from '@mes/contracts'
import { filesForTask, saveAssistantOutput, type FileMeta } from '@/api/files'
import { useActor } from '@/app/hooks'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useT } from '@/i18n'

export function defaultOutputName(own: (Pick<FileMeta, 'name' | 'source' | 'uploadedAt'> & { isOutput?: boolean })[], level2: string, code: string): string {
  const latest = own.filter((file) => file.source === 'assistant' || file.isOutput).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))[0]
  return latest?.name ?? `${level2.replace(/\s+/g, '')}_${code}.md`
}

export function SaveAsOutputDialog({ message, task, assistant, onClose }: { message: Message; task: Task; assistant: Assistant; onClose: () => void }) {
  const t = useT()
  const actor = useActor()
  const own = useQuery({ queryKey: ['files', task.id], queryFn: () => filesForTask(task.id) })
  const [edited, setEdited] = useState<string>()
  const [saving, setSaving] = useState(false)
  const name = edited ?? defaultOutputName(own.data ?? [], assistant.level2, task.code)
  const previous = (own.data ?? []).filter((file) => file.name === name.trim()).sort((a, b) => b.version - a.version)[0]
  async function save() {
    if (!name.trim()) return
    setSaving(true)
    try {
      const result = await saveAssistantOutput(actor, task.id, name.trim(), message.content)
      toast.success(t('chat.outputSaved', { name: result.name, version: String(result.version) }))
      onClose()
    } catch (error) { toast.error(t('chat.outputSaveFailed'), { description: error instanceof Error ? error.message : String(error) }) }
    finally { setSaving(false) }
  }
  return <Dialog open onOpenChange={(open) => !open && onClose()}><DialogContent><DialogHeader><DialogTitle>{t('chat.saveAsOutput')}</DialogTitle><DialogDescription>{t('chat.saveAsOutputDescription')}</DialogDescription></DialogHeader>
    <label htmlFor="out-name" className="text-xs">{t('chat.fileName')}</label><Input id="out-name" value={name} onChange={(event) => setEdited(event.target.value)} />
    <p className="text-xs text-muted-foreground">{previous ? t('chat.nextVersion', { version: String(previous.version), next: String(previous.version + 1) }) : t('chat.newFile')}</p>
    <DialogFooter><Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button><Button onClick={() => void save()} disabled={!name.trim() || saving}>{t('chat.save')}</Button></DialogFooter>
  </DialogContent></Dialog>
}
