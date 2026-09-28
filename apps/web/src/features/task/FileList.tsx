import { useState, type ReactNode } from 'react'
import { Download, History, Sparkles, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { deleteFile, downloadBlob, formatSize, type FileMeta } from '@/api/files'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { FileVersionsDialog } from './FileVersionsDialog'

export function FileList({ files, taskId, onToggleOutput, onPreview, canDelete = true, renderActions }: {
  files: FileMeta[]; taskId?: string; onToggleOutput?: (fileId: string, isOutput: boolean) => void;
  onPreview?: (file: FileMeta) => void; canDelete?: boolean; renderActions?: (file: FileMeta) => ReactNode
}) {
  const [deleting, setDeleting] = useState<FileMeta | null>(null)
  const [history, setHistory] = useState<FileMeta | null>(null)
  async function remove() {
    if (!deleting) return
    const result = await deleteFile(deleting.id)
    if (!result.ok) toast.error(result.reason ?? '파일을 삭제하지 못했습니다.')
    else toast.success('파일을 삭제했습니다.')
  }
  if (!files.length) return <div className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">파일이 없습니다.</div>
  return <><ul className="space-y-1">{files.map((file) => <li key={file.id} data-testid={`file-${file.id}`} className="flex items-center gap-1 rounded-lg border bg-card px-2 py-1.5 text-xs">
    <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => onPreview?.(file)}>{file.name} v{file.version}</button>
    {file.source === 'assistant' && <span className="rounded bg-violet-50 px-1 text-[10px] text-violet-800">assistant</span>}
    <span className="text-[10px] text-muted-foreground">{formatSize(file.size)}</span>
    {renderActions?.(file)}
    {taskId && onToggleOutput && <button type="button" aria-label={file.isOutput ? '산출물 해제' : '산출물로 지정'} onClick={() => onToggleOutput(file.id, !file.isOutput)}><Sparkles className={`size-3.5 ${file.isOutput ? 'fill-violet-300 text-violet-500' : ''}`} /></button>}
    <button type="button" aria-label="버전 기록" onClick={() => setHistory(file)}><History className="size-3.5" /></button>
    <button type="button" aria-label="다운로드" onClick={() => void downloadBlob(file)}><Download className="size-3.5" /></button>
    {canDelete && file.originTaskId === taskId && <button type="button" aria-label="삭제" onClick={() => setDeleting(file)}><Trash2 className="size-3.5" /></button>}
  </li>)}</ul>
    {history && <FileVersionsDialog file={history} onClose={() => setHistory(null)} onPreview={onPreview} />}
    <ConfirmDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)} title="파일을 삭제할까요?" description="다른 대화에서 입력으로 사용하는 버전 체인은 삭제할 수 없습니다." onConfirm={remove} />
  </>
}
