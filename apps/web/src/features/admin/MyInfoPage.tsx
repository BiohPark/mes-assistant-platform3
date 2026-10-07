import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Me } from '@mes/contracts'
import { localeOptions, themeOptions, useProfile } from '@/app/profile'
import { TopBar } from '@/app/TopBar'
import { useMe } from '@/app/auth'
import { setMyName } from '@/api/admin'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function MyInfoPage() {
  const me = useMe()
  const profile = useProfile()
  const client = useQueryClient()
  const [name, setName] = useState(me.name)
  async function submit(event: FormEvent) {
    event.preventDefault()
    try {
      const updated = await setMyName(name.trim())
      client.setQueryData<Me>(['me'], (current) => ({ ...(current ?? me), name: updated.name }))
      toast.success('이름을 저장했습니다')
    } catch (error) { toast.error(error instanceof Error ? error.message : '변경 실패') }
  }
  return <><TopBar title="내 정보" /><div className="flex-1 p-6"><form onSubmit={(event) => void submit(event)} className="mx-auto max-w-sm space-y-3 rounded-xl border bg-card p-5 text-sm">
    <label className="block">이름<Input value={name} onChange={(event) => setName(event.target.value)} required minLength={1} maxLength={40} /></label>
    <fieldset disabled={profile.pending} className="space-y-1.5"><legend>테마</legend><div className="flex gap-1 rounded-lg bg-muted p-1">
      {themeOptions.map((option) => <label key={option.value} className="flex-1 cursor-pointer rounded-lg px-2 py-1.5 text-center has-checked:bg-background has-checked:font-medium has-checked:shadow-xs focus-within:ring-2 focus-within:ring-ring"><input className="sr-only" type="radio" name="theme" value={option.value} checked={profile.theme === option.value} onChange={() => profile.save({ theme: option.value })} />{option.label}</label>)}
    </div></fieldset>
    <fieldset disabled={profile.pending} className="space-y-1.5"><legend>언어</legend><div className="flex gap-1 rounded-lg bg-muted p-1">
      {localeOptions.map((option) => <label key={option.value} className="flex-1 cursor-pointer rounded-lg px-2 py-1.5 text-center has-checked:bg-background has-checked:font-medium has-checked:shadow-xs focus-within:ring-2 focus-within:ring-ring"><input className="sr-only" type="radio" name="locale" value={option.value} checked={profile.locale === option.value} onChange={() => profile.save({ locale: option.value })} />{option.label}</label>)}
    </div></fieldset>
    <Button type="submit" disabled={profile.pending}>저장</Button>
  </form></div></>
}
