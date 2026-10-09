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
      {onPreview ? <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => onPreview(version)}>{version.name} v{version.version}</button> : <span className="min-w-0 flex-1 truncate">{version.name} v{version.version}</span>}<span className="text-muted-foreground">{formatSize(version.size)}</span>
      <button type="button" className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg hover:bg-muted" aria-label={t('task.files.downloadVersion', { name: version.name, version: String(version.version) })} onClick={() => void downloadBlob(version, t)}><Download className="size-4" /></button>
    </li>)}</ul>}
  </DialogContent></Dialog>
}
