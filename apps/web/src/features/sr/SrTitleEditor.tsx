import { useState } from 'react'
import { toast } from 'sonner'
import { titleSr, type SrDetail } from '@/api/sr'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function SrTitleEditor({ sr, onSaved }: { sr: SrDetail; onSaved: () => void }) {
  const [title, setTitle] = useState(sr.title)
  return <form className="flex gap-2" onSubmit={async (event) => { event.preventDefault(); try { await titleSr(sr.id, title); onSaved() } catch (error) { toast.error(String(error)) } }}>
    <Input aria-label="SR 제목" value={title} onChange={(event) => setTitle(event.target.value)} />
    <Button type="submit" disabled={!title.trim() || title === sr.title}>제목 저장</Button>
  </form>
}
