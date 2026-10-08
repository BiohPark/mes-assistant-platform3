import { useCallback, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { TopBar } from '@/app/TopBar'
import { useAssistants } from '@/app/hooks'
import { useT } from '@/i18n'
import { AssistantPicker } from '@/components/AssistantPicker'
import { Field } from '@/components/Field'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Chip } from '@/components/Chip'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useMe } from '@/app/auth'
import { getSettings, listManagedUsers, saveSettings, setUserFlag, setUserName, temporaryPassword, type ManagedUser, type Settings } from '@/api/admin'

function SettingsForm({ initial }: { initial: Settings }) {
  const t = useT()
  const [form, setForm] = useState<Settings>(initial)
  const assistants = useAssistants()
  const options = useMemo(() => assistants.map(row => ({ value: row.id, label: row.name, status: row.status })), [assistants])
  const assistantSource = useCallback(() => options, [options])
  const client = useQueryClient()
  function change<K extends keyof Settings>(key: K, value: Settings[K]) { setForm((current) => ({ ...current, [key]: value })) }
  async function submit(event: FormEvent) {
    event.preventDefault()
    try { await saveSettings(form); void client.invalidateQueries({ queryKey: ['settings'] }); toast.success(t('admin.settings.saved')) }
    catch (error) { toast.error(error instanceof Error ? error.message : t('admin.saveFailed')) }
  }
  return <form onSubmit={(event) => void submit(event)} className="space-y-3 rounded-xl border bg-card p-4 text-sm"><h2 className="font-semibold">{t('admin.settings.global')}</h2>
    <Field label={t('admin.defaultModel')}><Input value={form.defaultModel ?? ''} onChange={(event) => change('defaultModel', event.target.value)} required /></Field>
    <fieldset><legend className="mb-1">{t('admin.fileDelivery')}</legend><RadioGroup value={form.fileDelivery ?? 'inline'} onValueChange={value => change('fileDelivery', value as Settings['fileDelivery'])} aria-label={t('admin.fileDelivery')} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {(['inline', 'openwebui'] as const).map(value => <label key={value} className="flex cursor-pointer items-center gap-2 rounded-xl border p-3 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-accent"><RadioGroupItem value={value} />{t(value === 'inline' ? 'admin.deliveryInline' : 'admin.deliveryOpenWebUi')}</label>)}
    </RadioGroup></fieldset>
    <Field label={t('admin.settings.requestBudget')}><Input type="number" min={1024} max={100000000} value={form.requestBudgetBytes ?? 1000000} onChange={(event) => change('requestBudgetBytes', Number(event.target.value))} /></Field>
    <Field label={t('admin.fileMaxPerRequest')}><Input type="number" min={1} max={100} value={form.fileMaxPerRequest ?? 10} onChange={(event) => change('fileMaxPerRequest', Number(event.target.value))} /></Field>
    <div><Field label={t('admin.intakeAssistant')}><AssistantPicker mode="single" source={assistantSource}
      value={options.find(option => option.value === form.srIntakeAssistantId) ?? null} aria-label={t('admin.intakeAssistant')}
      onChange={option => change('srIntakeAssistantId', option?.value ?? null)} /></Field>
      <Chip label={t('admin.noAssistant')} selected={!form.srIntakeAssistantId} onClick={() => change('srIntakeAssistantId', null)} className="mt-1.5" /></div>
    <Field label={t('admin.settings.link1Rule', { modelId: '{modelId}' })}><textarea className="w-full rounded-lg border bg-background p-2" value={form.link1Rule ?? ''} onChange={(event) => change('link1Rule', event.target.value)} placeholder="https://openwebui.example/?model={modelId}" /></Field>
    <Button type="submit">{t('admin.settings.saveSettings')}</Button>
  </form>
}
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
export function SettingsPage() {
  const t = useT()
  const query = useQuery({ queryKey: ['settings'], queryFn: getSettings })
  return <><TopBar title={t('nav.settings')} /><div className="flex-1 overflow-auto p-4"><div className="mx-auto max-w-3xl space-y-4"><Link className="text-sm text-primary underline" to="/admin/diagnostics">{t('admin.settings.openDiagnostics')}</Link>{query.data ? <SettingsForm key={JSON.stringify(query.data)} initial={query.data} /> : <p>{t('admin.settings.loading')}</p>}<UsersSection /></div></div></>
}
