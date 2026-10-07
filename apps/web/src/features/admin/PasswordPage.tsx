import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { TopBar } from '@/app/TopBar'
import { useMe } from '@/app/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { adminRequest } from '@/api/admin'

export function PasswordPage() {
  const me = useMe()
  const client = useQueryClient()
  const navigate = useNavigate()
  const [currentPassword, setCurrent] = useState('')
  const [newPassword, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault(); setError('')
    if (newPassword !== confirm) { setError('새 비밀번호가 일치하지 않습니다'); return }
    try {
      await adminRequest('auth/password', 'POST', { currentPassword, newPassword })
      client.clear()
      void navigate('/login', { replace: true })
    } catch (cause) { setError(cause instanceof Error ? cause.message : '변경 실패') }
  }
  return <><TopBar title="비밀번호 변경" /><div className="flex-1 p-6"><form onSubmit={(event) => void submit(event)} className="mx-auto max-w-sm space-y-3 rounded-xl border bg-card p-5 text-sm"><h2 className="font-semibold">{me.mustChangePassword ? '비밀번호를 변경해야 계속할 수 있습니다' : '비밀번호 변경'}</h2>
    <label className="block">현재 비밀번호<Input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrent(event.target.value)} required minLength={8} /></label>
    <label className="block">새 비밀번호<Input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNext(event.target.value)} required minLength={8} maxLength={128} /></label>
    <label className="block">새 비밀번호 확인<Input type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} required /></label>
    {error && <p role="alert" className="text-destructive">{error}</p>}<Button type="submit">변경</Button>
  </form></div></>
}
