import { useState, type ReactNode } from 'react'
import { Download, History, Sparkles, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { deleteFile, downloadBlob, formatSize, type FileMeta } from '@/api/files'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { useT } from '@/i18n'
import { FileVersionsDialog } from './FileVersionsDialog'

export function FileList({ files, taskId, onToggleOutput, onPreview, canDelete = true, canViewHistory = true, renderActions }: {
  files: FileMeta[]; taskId?: string; onToggleOutput?: (fileId: string, isOutput: boolean) => void;
  onPreview?: (file: FileMeta) => void; canDelete?: boolean; canViewHistory?: boolean; renderActions?: (file: FileMeta) => ReactNode
}) {
  const t = useT()
  const [deleting, setDeleting] = useState<FileMeta | null>(null)
  const [history, setHistory] = useState<FileMeta | null>(null)
  async function remove() {
    if (!deleting) return
    const result = await deleteFile(deleting.id)
    if (!result.ok) toast.error(result.reason ?? t('task.files.deleteFailed'))
    else toast.success(t('task.files.deleted'))
  }
  if (!files.length) return <div className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">{t('task.files.empty')}</div>
  return <><ul className="space-y-1">{files.map((file) => <li key={file.id} data-testid={`file-${file.id}`} className="flex items-center gap-1 rounded-lg border bg-card px-2 py-1.5 text-xs">
    <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => onPreview?.(file)}>{file.name} v{file.version}</button>
    {file.source === 'assistant' && <span className="rounded-full bg-violet-50 px-1 text-[11px] text-violet-800">{t('components.assistantSource')}</span>}
    <span className="text-xs text-muted-foreground">{formatSize(file.size)}</span>
    {renderActions?.(file)}
    {taskId && onToggleOutput && <button type="button" aria-label={file.isOutput ? t('task.files.unmarkOutput') : t('task.files.markOutput')} onClick={() => onToggleOutput(file.id, !file.isOutput)}><Sparkles className={`size-3.5 ${file.isOutput ? 'fill-violet-300 text-violet-500' : ''}`} /></button>}
    {canViewHistory && <button type="button" aria-label={t('task.files.versions')} onClick={() => setHistory(file)}><History className="size-3.5" /></button>}
    <button type="button" aria-label={t('task.download')} onClick={() => void downloadBlob(file)}><Download className="size-3.5" /></button>
    {canDelete && file.originTaskId === taskId && <button type="button" aria-label={t('task.delete')} onClick={() => setDeleting(file)}><Trash2 className="size-3.5" /></button>}
  </li>)}</ul>
    {history && <FileVersionsDialog file={history} onClose={() => setHistory(null)} onPreview={onPreview} />}
    <ConfirmDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)} title={t('task.files.deleteTitle')} description={t('task.files.deleteDescription')} confirmLabel={t('task.delete')} onConfirm={remove} />
  </>
}
