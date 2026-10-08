import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { TopBar } from '@/app/TopBar'
import { useT } from '@/i18n'
import { Field } from '@/components/Field'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useMe } from '@/app/auth'
import { listManagedUsers, setUserFlag, setUserName, temporaryPassword, type ManagedUser } from '@/api/admin'

function UserNameEditor({ user, onSaved }: { user: ManagedUser; onSaved: () => void }) {
  const t = useT()
  const [name, setName] = useState(user.name)
  return <form onSubmit={(event) => { event.preventDefault(); void setUserName(user.id, name.trim()).then(() => { onSaved(); toast.success(t('admin.nameSaved')) }, (error: unknown) => toast.error(error instanceof Error ? error.message : t('admin.changeFailed'))) }} className="flex gap-1">
    <Field label={t('admin.settings.userName', { name: user.loginId ?? user.id })} className="[&>label]:sr-only"><Input aria-label={t('admin.settings.userName', { name: user.loginId ?? user.id })} value={name} onChange={(event) => setName(event.target.value)} required minLength={1} maxLength={40} className="w-36" /></Field>
    <Button size="sm" variant="outline" type="submit">{t('admin.settings.saveName')}</Button>
  </form>
}
type PendingUserChange = { user: ManagedUser; field: 'system-owner' | 'active' | 'temporary-password' }
function UsersSection() {
  const t = useT()
  const me = useMe()
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['managed-users'], queryFn: listManagedUsers })
  const [issued, setIssued] = useState<{ id: string; password: string } | null>(null)
  const confirmTrigger = useRef<HTMLElement | null>(null)
  const [pending, setPending] = useState<PendingUserChange | null>(null)
  const [displayed, setDisplayed] = useState<PendingUserChange | null>(null)
  function confirmChange(user: ManagedUser, field: 'system-owner' | 'active' | 'temporary-password') {
    confirmTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setPending({ user, field })
    setDisplayed({ user, field })
  }
  const change = (id: string, field: 'system-owner' | 'business-owner' | 'active', enabled: boolean) => {
    return setUserFlag(id, field, enabled).then(() => void query.refetch(), (error: unknown) => toast.error(error instanceof Error ? error.message : t('admin.changeFailed')))
  }
  return <section className="space-y-3 rounded-xl border bg-card p-4 text-sm"><h2 className="font-semibold">{t('admin.settings.usersRoles')}</h2>
    {query.data?.map((user) => <div key={user.id} className="flex flex-wrap items-center gap-3 border-b py-2"><span className="min-w-36">{user.name}<small className="block text-muted-foreground">{user.loginId ?? 'SSO'}</small></span>
      <UserNameEditor user={user} onSaved={() => { void query.refetch(); if (user.id === me.id) void client.invalidateQueries({ queryKey: ['me'] }) }} />
      <Field label={'SO'} className="flex-row items-center gap-1 [&>label]:order-last"><Switch aria-label={t('admin.userFlag', { name: user.name, flag: 'SO' })} checked={user.isSystemOwner} onCheckedChange={enabled => { if (!enabled) confirmChange(user, 'system-owner'); else void change(user.id, 'system-owner', true) }} /></Field>
      <Field label={'BO'} className="flex-row items-center gap-1 [&>label]:order-last"><Switch aria-label={t('admin.userFlag', { name: user.name, flag: 'BO' })} checked={user.isBusinessOwner} onCheckedChange={enabled => void change(user.id, 'business-owner', enabled)} /></Field>
      <Field label={t('admin.active')} className="flex-row items-center gap-1 [&>label]:order-last"><Switch aria-label={t('admin.userFlag', { name: user.name, flag: t('admin.active') })} checked={user.active} onCheckedChange={enabled => { if (!enabled) confirmChange(user, 'active'); else void change(user.id, 'active', true) }} /></Field>
      {user.loginId && <Button size="sm" variant="outline" onClick={() => confirmChange(user, 'temporary-password')}>{t('admin.settings.temporaryPassword')}</Button>}
      {user.mustChangePassword && <span className="text-muted-foreground">{t('admin.settings.pendingChange')}</span>}
    </div>)}
    <ConfirmDialog onCloseAutoFocus={event => { event.preventDefault(); setDisplayed(null); confirmTrigger.current?.focus() }} open={!!pending} onOpenChange={open => { if (!open) setPending(null) }}
      title={displayed?.field === 'temporary-password' ? t('admin.settings.issueConfirm', { name: displayed.user.name }) : t(displayed?.field === 'system-owner' ? 'admin.removeSoTitle' : 'admin.deactivateTitle')}
      description={displayed?.field === 'temporary-password' ? undefined : t(displayed?.field === 'system-owner' ? 'admin.removeSoDescription' : 'admin.deactivateDescription', { name: displayed?.user.name ?? '' })}
      confirmLabel={t('common.confirm')} destructive={displayed?.field !== 'temporary-password'} onConfirm={async () => {
        if (!pending) return
        if (pending.field === 'temporary-password') {
          try { const result = await temporaryPassword(pending.user.id); setIssued({ id: pending.user.id, password: result.temporaryPassword }) }
          catch (error) { toast.error(error instanceof Error ? error.message : t('admin.settings.issueFailed')) }
        } else await change(pending.user.id, pending.field, false)
      }} />
    {issued && <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3">{t('admin.settings.issuedPassword')}<code className="select-all font-mono">{issued.password}</code><Button className="ml-2" size="sm" onClick={() => setIssued(null)}>{t('common.close')}</Button></div>}
  </section>
}
export function UsersPage() {
  const t = useT()
  return <><TopBar title={t('nav.users')} /><div className="flex-1 overflow-auto p-4"><div className="mx-auto max-w-3xl space-y-4"><UsersSection /></div></div></>
}
