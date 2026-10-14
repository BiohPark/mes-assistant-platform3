import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Me } from '@mes/contracts'
import { localeOptions, themeOptions, useProfile } from '@/app/profile'
import { TopBar } from '@/app/TopBar'
import { useMe } from '@/app/auth'
import { setMyAccountProfile } from '@/api/admin'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/Field'
import { Input } from '@/components/ui/input'
import { useT } from '@/i18n'
import { useAutoSave } from '@/lib/useAutoSave'
import { useUiStore } from '@/app/uiStore'
import { requestTutorial } from '@/features/assistant-pill/tutorial'

/** 이름·이메일은 입력을 떠날 때 바뀐 것만 저장한다. 테마·언어는 profile.save가 즉시 저장한다 */
export function MyInfoPage() {
  const t = useT()
  const me = useMe()
  const profile = useProfile()
  const client = useQueryClient()
  const [name, setName] = useState(me.name)
  const savedName = useRef(me.name)
  const [email, setEmail] = useState(me.email ?? '')
  const [savedEmail, setSavedEmail] = useState(me.email ?? '')
  const { states, run, fail, clear } = useAutoSave<'name' | 'email'>()
  const unchangedDefaultEmail = me.emailIsDefault && email === savedEmail
  async function applyMe(patch: Partial<Me>) {
    await client.cancelQueries({ queryKey: ['me'] })
    client.setQueryData<Me>(['me'], (current) => ({ ...(current ?? me), ...patch }))
  }
  function commitName() {
    const value = name.trim()
    if (!value) { fail('name', t('admin.nameRequired')); return }
    if (value === savedName.current) { clear('name'); return }
    void run('name', async () => {
      const updated = await setMyAccountProfile({ name: value })
      await applyMe({ name: updated.name })
      savedName.current = updated.name
    })
  }
  function commitEmail(input: HTMLInputElement) {
    if (email === savedEmail) { clear('email'); return }
    if (!input.checkValidity()) { fail('email', t('admin.emailInvalid')); return }
    void run('email', async () => {
      const updated = await setMyAccountProfile({ email: email || null })
      await applyMe({ email: updated.email, emailIsDefault: updated.emailIsDefault })
      setEmail(updated.email ?? ''); setSavedEmail(updated.email ?? '')
    })
  }
  return <><TopBar title={t('common.myInfo')} /><div className="flex-1 p-6"><div className="mx-auto max-w-sm space-y-3 rounded-xl border bg-card p-5 text-sm">
    <Field label={t('admin.name')} status={states.name}><Input value={name} onChange={(event) => setName(event.target.value)} onBlur={commitName} required minLength={1} maxLength={40} /></Field>
    <Field label={t('admin.email')} help={unchangedDefaultEmail ? t('admin.emailDefault') : t('admin.emailClearHint')} status={states.email}><Input type={unchangedDefaultEmail ? 'text' : 'email'} inputMode="email" maxLength={191} value={email} onChange={(event) => setEmail(event.target.value)} onBlur={(event) => commitEmail(event.target)} disabled={states.email?.status === 'saving'} /></Field>
    <fieldset disabled={profile.pending} className="space-y-1.5"><legend>{t('common.theme')}</legend><div className="flex gap-1 rounded-lg bg-muted p-1">
      {themeOptions.map((option) => <label key={option.value} className="flex-1 cursor-pointer rounded-lg px-2 py-1.5 text-center has-checked:bg-background has-checked:font-medium has-checked:shadow-xs focus-within:ring-2 focus-within:ring-ring"><input className="sr-only" type="radio" name="theme" value={option.value} checked={profile.theme === option.value} onChange={() => profile.save({ theme: option.value })} />{t(option.key)}</label>)}
    </div></fieldset>
    <fieldset disabled={profile.pending} className="space-y-1.5"><legend>{t('common.language')}</legend><div className="flex gap-1 rounded-lg bg-muted p-1">
      {localeOptions.map((option) => <label key={option.value} className="flex-1 cursor-pointer rounded-lg px-2 py-1.5 text-center has-checked:bg-background has-checked:font-medium has-checked:shadow-xs focus-within:ring-2 focus-within:ring-ring"><input className="sr-only" type="radio" name="locale" value={option.value} checked={profile.locale === option.value} onChange={() => profile.save({ locale: option.value })} />{t(option.key)}</label>)}
    </div></fieldset>
    <Button type="button" variant="outline" onClick={() => { requestTutorial(me.id); useUiStore.getState().setAssistantOpen(true) }}>{t('tutorial.replay')}</Button>
  </div></div></>
}
