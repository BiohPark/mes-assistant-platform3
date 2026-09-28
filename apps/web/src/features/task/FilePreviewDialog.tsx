import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { downloadBlob, isTextFile, type FileMeta } from '@/api/files'

export function FilePreviewDialog({ file, onClose }: { file: FileMeta | null; onClose: () => void }) {
  const [preview, setPreview] = useState<{ id: string; text?: string; url?: string; error?: string }>()
  useEffect(() => {
    if (!file) return
    let active = true
    let url: string | undefined
    void fetch(`/api/files/${encodeURIComponent(file.id)}/content`, { credentials: 'same-origin' }).then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      if (isTextFile(file)) return { id: file.id, text: await response.text() }
      if (file.mime.startsWith('image/')) { url = URL.createObjectURL(await response.blob()); return { id: file.id, url } }
      return { id: file.id }
    }).then((next) => { if (active) setPreview(next) }).catch((error) => { if (active) setPreview({ id: file.id, error: error instanceof Error ? error.message : String(error) }) })
    return () => { active = false; if (url) URL.revokeObjectURL(url) }
  }, [file])
  return <Dialog open={!!file} onOpenChange={(open) => !open && onClose()}><DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>{file?.name}</DialogTitle></DialogHeader>
    {file && (preview?.id !== file.id ? <p className="text-sm">불러오는 중…</p> : preview.error ? <p role="alert">{preview.error}</p> : preview.text !== undefined ? <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap text-xs">{preview.text}</pre> : preview.url ? <img src={preview.url} alt={file.name} className="max-h-[60vh] w-full object-contain" /> : <p className="text-sm">미리보기를 지원하지 않는 형식입니다.</p>)}
    {file && <button type="button" className="text-left text-xs underline" onClick={() => void downloadBlob(file)}>다운로드</button>}
  </DialogContent></Dialog>
}
