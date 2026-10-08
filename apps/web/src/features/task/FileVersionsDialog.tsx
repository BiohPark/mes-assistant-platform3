import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { downloadBlob, fileVersions, formatSize, type FileMeta } from '@/api/files'
import { useT } from '@/i18n'

export function FileVersionsDialog({ file, onClose, onPreview }: { file: FileMeta; onClose: () => void; onPreview?: (file: FileMeta) => void }) {
  const t = useT()
  const versions = useQuery({ queryKey: ['file-versions', file.id], queryFn: () => fileVersions(file.id) })
  return <Dialog open onOpenChange={(open) => !open && onClose()}><DialogContent><DialogHeader><DialogTitle>{t('task.files.versionsTitle', { name: file.name })}</DialogTitle></DialogHeader>
    {versions.isError ? <p role="alert">{t('task.files.versionsFailed')}</p> : <ul className="space-y-2">{versions.data?.map((version) => <li key={version.id} className="flex items-center gap-2 rounded-xl border p-2 text-xs">
      <button type="button" className="flex-1 text-left hover:underline" onClick={() => onPreview?.(version)}>{version.name} v{version.version}</button><span className="text-muted-foreground">{formatSize(version.size)}</span>
      <button type="button" aria-label={t('task.files.downloadVersion', { name: version.name, version: String(version.version) })} onClick={() => void downloadBlob(version)}><Download className="size-4" /></button>
    </li>)}</ul>}
  </DialogContent></Dialog>
}
