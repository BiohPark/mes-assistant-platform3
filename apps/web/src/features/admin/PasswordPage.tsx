import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { TopBar } from '@/app/TopBar'
import { useMe } from '@/app/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { adminRequest } from '@/api/admin'
import { useT } from '@/i18n'

export function PasswordPage() {
  const t = useT()
  const me = useMe()
  const client = useQueryClient()
  const navigate = useNavigate()
  const [currentPassword, setCurrent] = useState('')
  const [newPassword, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault(); setError('')
    if (newPassword !== confirm) { setError(t('admin.password.mismatch')); return }
    try {
      await adminRequest('auth/password', 'POST', { currentPassword, newPassword })
      client.clear()
      void navigate('/login', { replace: true })
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('admin.changeFailed')) }
  }
  return <><TopBar title={t('common.changePassword')} /><div className="flex-1 p-6"><form onSubmit={(event) => void submit(event)} className="mx-auto max-w-sm space-y-3 rounded-xl border bg-card p-5 text-sm"><h2 className="font-semibold">{me.mustChangePassword ? t('admin.password.mustChange') : t('common.changePassword')}</h2>
    <label className="block">{t('admin.password.current')}<Input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrent(event.target.value)} required minLength={8} /></label>
    <label className="block">{t('admin.password.next')}<Input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNext(event.target.value)} required minLength={8} maxLength={128} /></label>
    <label className="block">{t('admin.password.confirm')}<Input type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} required /></label>
    {error && <p role="alert" className="text-destructive">{error}</p>}<Button type="submit">{t('admin.password.change')}</Button>
  </form></div></>
}
