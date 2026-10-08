import { useT } from '@/i18n'
import { Pencil } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { titleSr, type SrDetail } from '@/api/sr'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function SrTitleEditor({ sr, onSaved }: { sr: SrDetail; onSaved: () => void }) {
  const t = useT()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(sr.title)
  if (!editing) return <div className="flex items-center gap-1"><h1 className="font-semibold">{sr.title || t('sr.untitled')}</h1><Button variant="ghost" size="icon-sm" aria-label={t('sr.editTitle')} onClick={() => setEditing(true)}><Pencil className="size-3.5" /></Button></div>
  return <form className="flex gap-2" onSubmit={async (event) => { event.preventDefault(); try { await titleSr(sr.id, title); onSaved(); setEditing(false) } catch (error) { toast.error(String(error)) } }}>
    <Input aria-label={t('sr.title')} value={title} onChange={(event) => setTitle(event.target.value)} />
    <Button type="submit" disabled={!title.trim() || title === sr.title}>{t('sr.saveTitle')}</Button>
  </form>
}
