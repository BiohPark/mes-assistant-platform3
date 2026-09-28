import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { downloadBlob, fileVersions, formatSize, type FileMeta } from '@/api/files'

export function FileVersionsDialog({ file, onClose, onPreview }: { file: FileMeta; onClose: () => void; onPreview?: (file: FileMeta) => void }) {
  const versions = useQuery({ queryKey: ['file-versions', file.id], queryFn: () => fileVersions(file.id) })
  return <Dialog open onOpenChange={(open) => !open && onClose()}><DialogContent><DialogHeader><DialogTitle>버전 기록 · {file.name}</DialogTitle></DialogHeader>
    {versions.isError ? <p role="alert">버전 기록을 불러오지 못했습니다.</p> : <ul className="space-y-2">{versions.data?.map((version) => <li key={version.id} className="flex items-center gap-2 rounded border p-2 text-xs">
      <button type="button" className="flex-1 text-left hover:underline" onClick={() => onPreview?.(version)}>{version.name} v{version.version}</button><span className="text-muted-foreground">{formatSize(version.size)}</span>
      <button type="button" aria-label={`${version.name} v${version.version} 다운로드`} onClick={() => void downloadBlob(version)}><Download className="size-4" /></button>
    </li>)}</ul>}
  </DialogContent></Dialog>
}
