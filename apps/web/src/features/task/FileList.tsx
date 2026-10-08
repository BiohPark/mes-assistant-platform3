import { useT } from '@/i18n'
import { useState, type ReactNode } from 'react'
import { Download, History, Sparkles, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { deleteFile, downloadBlob, formatSize, type FileMeta } from '@/api/files'
import { ConfirmDialog } from '@/components/ConfirmDialog'
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
    if (!result.ok) toast.error(result.reason ?? t('components.fileDeleteFailed'))
    else toast.success(t('components.fileDeleted'))
  }
  if (!files.length) return <div className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">{t('components.noFiles')}</div>
  return <><ul className="space-y-1">{files.map((file) => <li key={file.id} data-testid={`file-${file.id}`} className="flex items-center gap-1 rounded-lg border bg-card px-2 py-1.5 text-xs">
    <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => onPreview?.(file)}>{file.name} v{file.version}</button>
    {file.source === 'assistant' && <span className="rounded-full bg-violet-50 px-1 text-[11px] text-violet-800">{t('components.assistantSource')}</span>}
    <span className="text-xs text-muted-foreground">{formatSize(file.size)}</span>
    {renderActions?.(file)}
    {taskId && onToggleOutput && <button type="button" aria-label={file.isOutput ? t('components.outputOff') : t('components.outputOn')} onClick={() => onToggleOutput(file.id, !file.isOutput)}><Sparkles className={`size-3.5 ${file.isOutput ? 'fill-violet-300 text-violet-500' : ''}`} /></button>}
    {canViewHistory && <button type="button" aria-label={t('components.fileHistory')} onClick={() => setHistory(file)}><History className="size-3.5" /></button>}
    <button type="button" aria-label={t('components.download')} onClick={() => void downloadBlob(file)}><Download className="size-3.5" /></button>
    {canDelete && file.originTaskId === taskId && <button type="button" aria-label={t('components.delete')} onClick={() => setDeleting(file)}><Trash2 className="size-3.5" /></button>}
  </li>)}</ul>
    {history && <FileVersionsDialog file={history} onClose={() => setHistory(null)} onPreview={onPreview} />}
    <ConfirmDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)} title={t('components.fileDeleteConfirm')} description={t('components.fileDeleteDescription')} confirmLabel={t('components.delete')} onConfirm={remove} />
  </>
}
