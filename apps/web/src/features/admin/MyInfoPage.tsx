import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { TopBar } from '@/app/TopBar'
import { useMe } from '@/app/auth'
import { setMyName } from '@/api/admin'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function MyInfoPage() {
  const me = useMe()
  const client = useQueryClient()
  const [name, setName] = useState(me.name)
  async function submit(event: FormEvent) {
    event.preventDefault()
    try {
      const updated = await setMyName(name.trim()) as { name: string }
      client.setQueryData(['me'], { ...me, name: updated.name })
      toast.success('이름을 저장했습니다')
    } catch (error) { toast.error(error instanceof Error ? error.message : '변경 실패') }
  }
  return <><TopBar title="내 정보" /><div className="flex-1 p-6"><form onSubmit={(event) => void submit(event)} className="mx-auto max-w-sm space-y-3 rounded-xl border bg-card p-5 text-sm">
    <label className="block">이름<Input value={name} onChange={(event) => setName(event.target.value)} required minLength={1} maxLength={40} /></label>
    <Button type="submit">저장</Button>
  </form></div></>
}
