import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Me } from '@mes/contracts'
import { localeOptions, themeOptions, useProfile } from '@/app/profile'
import { TopBar } from '@/app/TopBar'
import { useMe } from '@/app/auth'
import { setMyAccountProfile } from '@/api/admin'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/Field'
import { Input } from '@/components/ui/input'
import { useT } from '@/i18n'

export function MyInfoPage() {
  const t = useT()
  const me = useMe()
  const profile = useProfile()
  const client = useQueryClient()
  const [name, setName] = useState(me.name)
  const [email, setEmail] = useState(me.email ?? '')
  const [savedEmail, setSavedEmail] = useState(me.email ?? '')
  const [saving, setSaving] = useState(false)
  const unchangedDefaultEmail = me.emailIsDefault && email === savedEmail
  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    const emailChanged = email !== savedEmail
    try {
      const updated = await setMyAccountProfile({ name: name.trim(), ...(emailChanged && { email: email || null }) })
      await client.cancelQueries({ queryKey: ['me'] })
      client.setQueryData<Me>(['me'], (current) => ({ ...(current ?? me), name: updated.name,
        ...(emailChanged && { email: updated.email, emailIsDefault: updated.emailIsDefault }),
      }))
      if (emailChanged) { setEmail(updated.email ?? ''); setSavedEmail(updated.email ?? '') }
      toast.success(t('admin.profileSaved'))
    } catch (error) { toast.error(error instanceof Error ? error.message : t('admin.changeFailed')) }
    finally { setSaving(false) }
  }
  return <><TopBar title={t('common.myInfo')} /><div className="flex-1 p-6"><form onSubmit={(event) => void submit(event)} className="mx-auto max-w-sm space-y-3 rounded-xl border bg-card p-5 text-sm">
    <Field label={t('admin.name')}><Input value={name} onChange={(event) => setName(event.target.value)} required minLength={1} maxLength={40} /></Field>
    <Field label={t('admin.email')} help={unchangedDefaultEmail ? t('admin.emailDefault') : t('admin.emailClearHint')}><Input type={unchangedDefaultEmail ? 'text' : 'email'} inputMode="email" maxLength={191} value={email} onChange={(event) => setEmail(event.target.value)} disabled={saving} /></Field>
    <fieldset disabled={profile.pending} className="space-y-1.5"><legend>{t('common.theme')}</legend><div className="flex gap-1 rounded-lg bg-muted p-1">
      {themeOptions.map((option) => <label key={option.value} className="flex-1 cursor-pointer rounded-lg px-2 py-1.5 text-center has-checked:bg-background has-checked:font-medium has-checked:shadow-xs focus-within:ring-2 focus-within:ring-ring"><input className="sr-only" type="radio" name="theme" value={option.value} checked={profile.theme === option.value} onChange={() => profile.save({ theme: option.value })} />{t(option.key)}</label>)}
    </div></fieldset>
    <fieldset disabled={profile.pending} className="space-y-1.5"><legend>{t('common.language')}</legend><div className="flex gap-1 rounded-lg bg-muted p-1">
      {localeOptions.map((option) => <label key={option.value} className="flex-1 cursor-pointer rounded-lg px-2 py-1.5 text-center has-checked:bg-background has-checked:font-medium has-checked:shadow-xs focus-within:ring-2 focus-within:ring-ring"><input className="sr-only" type="radio" name="locale" value={option.value} checked={profile.locale === option.value} onChange={() => profile.save({ locale: option.value })} />{t(option.key)}</label>)}
    </div></fieldset>
    <Button type="submit" disabled={profile.pending || saving}>{t('admin.save')}</Button>
  </form></div></>
}
