import { useCallback, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { LlmStatusSchema } from '@mes/contracts'
import { TopBar } from '@/app/TopBar'
import { useAssistants } from '@/app/hooks'
import { useT } from '@/i18n'
import { AssistantPicker } from '@/components/AssistantPicker'
import { Field } from '@/components/Field'
import { Chip } from '@/components/Chip'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ModelSelect } from '@/components/ModelSelect'
import { useModelList } from '@/lib/useModelList'
import { getSettings, saveSettings, type Settings, type SettingsPatch } from '@/api/admin'

function SettingsForm({ initial }: { initial: Settings }) {
  const t = useT()
  const { defaultModel, defaultModelSource, owuiTools: _owuiTools, ...patchable } = initial
  const modelList = useModelList()
  const [form, setForm] = useState<SettingsPatch>(patchable)
  const savedModelOverride = useRef(initial.defaultModelOverride ?? null)
  const assistants = useAssistants()
  const options = useMemo(() => assistants.map(row => ({ value: row.id, label: row.name, status: row.status })), [assistants])
  const assistantSource = useCallback(() => options, [options])
  const client = useQueryClient()
  function change<K extends keyof SettingsPatch>(key: K, value: SettingsPatch[K]) { setForm((current) => ({ ...current, [key]: value })) }
  async function submit(event: FormEvent) {
    event.preventDefault()
    const { defaultModelOverride, ...otherSettings } = form
    const patch: SettingsPatch = otherSettings
    const modelOverride = defaultModelOverride ?? null
    if (modelOverride !== savedModelOverride.current) patch.defaultModelOverride = modelOverride
    try {
      await saveSettings(patch)
      savedModelOverride.current = modelOverride
      await client.invalidateQueries({ queryKey: ['settings'] })
      void client.invalidateQueries({ queryKey: ['system-assistant', 'model'] })
      void client.invalidateQueries({ queryKey: ['diagnostics'] })
      toast.success(t('admin.settings.saved'))
    }
    catch (error) { toast.error(error instanceof Error ? error.message : t('admin.saveFailed')) }
  }
  return <form onSubmit={(event) => void submit(event)} className="space-y-3 rounded-xl border bg-card p-4 text-sm"><h2 className="font-semibold">{t('admin.settings.global')}</h2>
    <div className="space-y-1.5">
      <Field label={t('admin.defaultModel')}><ModelSelect aria-label={t('admin.defaultModel')} value={form.defaultModelOverride ?? ''}
        selectionOnly disabled={modelList.loading || !!modelList.error} placeholder={t('admin.settings.useEnvModel')}
        onChange={model => change('defaultModelOverride', model || null)} /></Field>
      {modelList.loading && <p role="status" className="text-xs text-muted-foreground">{t('admin.test.modelLoading')}</p>}
      {modelList.error && <div role="alert" className="text-xs text-destructive">{t('admin.settings.modelLoadFailed')} <Button type="button" variant="outline" size="sm" onClick={() => void modelList.reload()}>{t('admin.test.modelRetry')}</Button></div>}
      <Button type="button" variant="outline" size="sm" onClick={() => change('defaultModelOverride', null)}>{t('admin.settings.clearDefaultModel')}</Button>
      <p>{t('admin.settings.effectiveModel', { model: defaultModel || '—' })}</p>
      <p className="text-xs text-muted-foreground">{t('admin.settings.modelSource', { source: t(`admin.settings.modelSource${defaultModelSource ?? 'default'}`) })}</p>
      <p className="text-xs text-muted-foreground">{t('admin.settings.defaultModelEnvHint')}</p>
    </div>
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
/** 도구 전달은 다른 설정의 stale 저장과 섞이지 않게 별도 PATCH한다. */
function OwuiToolsForm({ initial }: { initial: Settings }) {
  const t = useT()
  const headingId = useId()
  const client = useQueryClient()
  const [value, setValue] = useState(initial.owuiTools ?? 'auto')
  const [saved, setSaved] = useState(initial.owuiTools ?? 'auto')
  const [saving, setSaving] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (value === saved || saving) return
    setSaving(true)
    try {
      await saveSettings({ owuiTools: value })
      setSaved(value)
      await client.invalidateQueries({ queryKey: ['settings'] })
      toast.success(t('admin.settings.saved'))
    } catch (error) { toast.error(error instanceof Error ? error.message : t('admin.saveFailed')) }
    finally { setSaving(false) }
  }
  return <form aria-labelledby={headingId} onSubmit={event => void submit(event)} className="space-y-3 rounded-xl border bg-card p-4 text-sm">
    <h2 id={headingId} className="font-semibold">{t('admin.settings.owuiTools')}</h2>
    <fieldset aria-labelledby={headingId}>
      <RadioGroup aria-label={t('admin.settings.owuiTools')} value={value} onValueChange={value => setValue(value as 'auto' | 'off')} disabled={saving}>
        {(['auto', 'off'] as const).map(option => <label key={option} className="flex cursor-pointer items-center gap-2"><RadioGroupItem value={option} />{t(option === 'auto' ? 'admin.settings.owuiAuto' : 'admin.settings.owuiOff')}</label>)}
      </RadioGroup>
    </fieldset>
    <p className="text-xs text-muted-foreground">{t('admin.settings.owuiHint')}</p>
    <Button type="submit" disabled={saving || value === saved}>{t('admin.settings.saveOwuiTools')}</Button>
  </form>
}

/** 우측 요약 카드 — TopBar와 같은 ['llm','status'] 캐시를 읽는다. 연결 시험·상세는 연결 진단 화면 몫 */
function AiSummary() {
  const t = useT()
  const status = useQuery({ queryKey: ['llm', 'status'], queryFn: async () => {
    const response = await fetch('/api/llm/status', { credentials: 'same-origin' })
    if (!response.ok) throw new Error(t('common.llmStatusFailed', { status: response.status }))
    return LlmStatusSchema.parse(await response.json())
  } })
  const rows: [string, string][] = status.data ? [
    [t('admin.diagnostics.llmMode'), status.data.mode === 'mock' ? 'Mock' : 'Live'], [t('admin.diagnostics.llmPreset'), status.data.preset], [t('admin.diagnostics.llmHost'), status.data.baseUrlHost],
    [t('admin.diagnostics.llmConnection'), `${status.data.ok ? t('admin.diagnostics.success') : t('admin.diagnostics.failure')} (${status.data.detail})`],
  ] : []
  return <section aria-labelledby="ai-summary" className="space-y-3 rounded-xl border bg-card p-4 text-sm lg:sticky lg:top-4"><h2 id="ai-summary" className="font-semibold">{t('admin.settings.aiSummary')}</h2>
    {status.isError && <p role="alert">{t('admin.diagnostics.lookupFailed')}</p>}
    {status.data ? <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">{rows.map(([name, value]) => <div className="contents" key={name}><dt className="text-muted-foreground">{name}</dt><dd className="break-all">{value}</dd></div>)}</dl> : !status.isError && <p className="text-muted-foreground">{t('common.loading')}</p>}
    <Link className="inline-block text-primary underline" to="/admin/diagnostics">{t('admin.settings.openDiagnostics')}</Link>
  </section>
}
export function SettingsPage() {
  const t = useT()
  const query = useQuery({ queryKey: ['settings'], queryFn: getSettings })
  return <><TopBar title={t('nav.settings')} /><div className="flex-1 overflow-auto p-4"><div className="mx-auto grid max-w-5xl items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
    {query.data ? <div className="space-y-4"><SettingsForm key={JSON.stringify(query.data)} initial={query.data} /><OwuiToolsForm key={query.data.owuiTools ?? 'auto'} initial={query.data} /></div> : <p>{t('admin.settings.loading')}</p>}
    <AiSummary />
  </div></div></>
}
