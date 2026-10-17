import { useCallback, useId, useMemo, useRef, useState } from 'react'
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
import { SaveStatus } from '@/components/SaveStatus'
import { useAutoSave } from '@/lib/useAutoSave'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ModelSelect } from '@/components/ModelSelect'
import { useModelList } from '@/lib/useModelList'
import { Sparkles } from 'lucide-react'
import { getSettings, listOwuiTerminals, saveSettings, uploadAssistantImage, type Settings, type SettingsPatch } from '@/api/admin'

type GeneralKey = keyof SettingsPatch
/** 값을 바꾸면 그 키만 바로 PATCH한다(숫자·주소는 blur). 다른 세션이 바꾼 값을 덮어쓰지 않는다 */
function SettingsForm({ initial }: { initial: Settings }) {
  const t = useT()
  const { urlAutoFetchAvailable: _urlAvailable, owuiTools: _owuiTools, assistantImageFileId: _assistantImage, defaultModel: _model, defaultModelSource: _source, ...patchable } = initial
  const modelList = useModelList()
  const terminals = useQuery({ queryKey: ['owui-terminals'], queryFn: listOwuiTerminals, staleTime: 5 * 60_000, retry: false })
  const [form, setForm] = useState<SettingsPatch>(patchable)
  const saved = useRef<SettingsPatch>(patchable)
  const { states, run } = useAutoSave<GeneralKey>()
  const assistants = useAssistants()
  const options = useMemo(() => assistants.map(row => ({ value: row.id, label: row.name, status: row.status })), [assistants])
  const assistantSource = useCallback(() => options, [options])
  const client = useQueryClient()
  function change<K extends GeneralKey>(key: K, value: SettingsPatch[K]) { setForm((current) => ({ ...current, [key]: value })) }
  function commit<K extends GeneralKey>(key: K, value: SettingsPatch[K]) {
    change(key, value)
    if ((value ?? null) === (saved.current[key] ?? null)) return
    void run(key, async () => {
      await saveSettings({ [key]: value })
      saved.current = { ...saved.current, [key]: value }
      await client.invalidateQueries({ queryKey: ['settings'] })
      if (key === 'defaultModelOverride') { void client.invalidateQueries({ queryKey: ['system-assistant', 'model'] }); void client.invalidateQueries({ queryKey: ['diagnostics'] }) }
    })
  }
  return <section aria-labelledby="general-settings" data-tour="admin-settings" className="space-y-3 rounded-xl border bg-card p-4 text-sm"><h2 id="general-settings" className="font-semibold">{t('admin.settings.global')}</h2>
    <div className="space-y-1.5">
      <Field label={t('admin.defaultModel')} status={states.defaultModelOverride}><ModelSelect aria-label={t('admin.defaultModel')} value={form.defaultModelOverride ?? ''}
        selectionOnly disabled={modelList.loading || !!modelList.error} placeholder={t('admin.settings.useEnvModel')}
        onChange={model => commit('defaultModelOverride', model || null)} /></Field>
      {modelList.loading && <p role="status" className="text-xs text-muted-foreground">{t('admin.test.modelLoading')}</p>}
      {modelList.error && <div role="alert" className="text-xs text-destructive">{t('admin.settings.modelLoadFailed')} <Button type="button" variant="outline" size="sm" onClick={() => void modelList.reload()}>{t('admin.test.modelRetry')}</Button></div>}
      <Button type="button" variant="outline" size="sm" onClick={() => commit('defaultModelOverride', null)}>{t('admin.settings.clearDefaultModel')}</Button>
      <p>{t('admin.settings.effectiveModel', { model: initial.defaultModel || '—' })}</p>
      <p className="text-xs text-muted-foreground">{t('admin.settings.modelSource', { source: t(`admin.settings.modelSource${initial.defaultModelSource ?? 'default'}`) })}</p>
      <p className="text-xs text-muted-foreground">{t('admin.settings.defaultModelEnvHint')}</p>
    </div>
    <div className="space-y-1.5">
      <Field label={t('admin.settings.defaultTerminal')} status={states.owuiDefaultTerminalId}>
        <Select value={form.owuiDefaultTerminalId ? `id:${form.owuiDefaultTerminalId}` : 'auto'}
          disabled={terminals.isPending || terminals.isError || states.owuiDefaultTerminalId?.status === 'saving'}
          onValueChange={value => commit('owuiDefaultTerminalId', value === 'auto' ? null : value.slice(3))}>
          <SelectTrigger aria-label={t('admin.settings.defaultTerminal')} className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">{t('admin.settings.terminalAuto')}</SelectItem>
            {form.owuiDefaultTerminalId && !terminals.data?.some(item => item.id === form.owuiDefaultTerminalId) && <SelectItem value={`id:${form.owuiDefaultTerminalId}`}>{t('admin.settings.terminalUnavailable')}</SelectItem>}
            {terminals.data?.map(item => <SelectItem key={item.id} value={`id:${item.id}`}>{item.name || item.id}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>
      <Button type="button" variant="outline" size="sm" disabled={!form.owuiDefaultTerminalId || states.owuiDefaultTerminalId?.status === 'saving'}
        onClick={() => commit('owuiDefaultTerminalId', null)}>{t('admin.settings.clearDefaultTerminal')}</Button>
      <p className="text-xs text-muted-foreground">{t('admin.settings.terminalHint')}</p>
      {terminals.isError && <div role="alert">{t('admin.settings.terminalLoadFailed')} <Button type="button" variant="outline" size="sm" onClick={() => void terminals.refetch()}>{t('admin.test.modelRetry')}</Button></div>}
    </div>
    <fieldset><legend className="mb-1">{t('admin.fileDelivery')}</legend><RadioGroup value={form.fileDelivery ?? 'inline'} onValueChange={value => commit('fileDelivery', value as Settings['fileDelivery'])} aria-label={t('admin.fileDelivery')} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {(['inline', 'openwebui'] as const).map(value => <label key={value} className="flex cursor-pointer items-center gap-2 rounded-xl border p-3 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-accent"><RadioGroupItem value={value} />{t(value === 'inline' ? 'admin.deliveryInline' : 'admin.deliveryOpenWebUi')}</label>)}
    </RadioGroup><SaveStatus state={states.fileDelivery} /></fieldset>
    <fieldset className="space-y-2"><legend>{t('admin.settings.urlReader')}</legend>
      <label className="flex items-center gap-2"><input type="checkbox" checked={form.urlAutoFetch ?? true} disabled={initial.urlAutoFetchAvailable === false} onChange={event => commit('urlAutoFetch', event.target.checked)} />{t('admin.settings.urlAutoFetch')}</label>
      <SaveStatus state={states.urlAutoFetch} />
      {initial.urlAutoFetchAvailable === false && <p>{t('admin.settings.urlDisabledEnv')}</p>}
      {(['urlAllowDomains', 'urlBlockDomains'] as const).map(key => <Field key={key} label={t(`admin.settings.${key}`)} help={t('admin.settings.urlDomainsHint')} status={states[key]}>
        <textarea className="w-full rounded-lg border bg-background p-2" value={(form[key] ?? []).join('\n')} onChange={event => change(key, event.target.value.split('\n'))}
          onBlur={event => commit(key, event.target.value.split(/[\s,]+/).map(value => value.trim().toLowerCase()).filter(Boolean))} />
      </Field>)}
    </fieldset>
    <Field label={t('admin.settings.requestBudget')} status={states.requestBudgetBytes}><Input type="number" min={1024} max={100000000} value={form.requestBudgetBytes ?? 1000000} onChange={(event) => change('requestBudgetBytes', Number(event.target.value))} onBlur={(event) => commit('requestBudgetBytes', Number(event.target.value))} /></Field>
    <Field label={t('admin.fileMaxPerRequest')} status={states.fileMaxPerRequest}><Input type="number" min={1} max={100} value={form.fileMaxPerRequest ?? 10} onChange={(event) => change('fileMaxPerRequest', Number(event.target.value))} onBlur={(event) => commit('fileMaxPerRequest', Number(event.target.value))} /></Field>
    <div><Field label={t('admin.intakeAssistant')} status={states.srIntakeAssistantId}><AssistantPicker mode="single" source={assistantSource}
      value={options.find(option => option.value === form.srIntakeAssistantId) ?? null} aria-label={t('admin.intakeAssistant')}
      onChange={option => commit('srIntakeAssistantId', option?.value ?? null)} /></Field>
      <Chip label={t('admin.noAssistant')} selected={!form.srIntakeAssistantId} onClick={() => commit('srIntakeAssistantId', null)} className="mt-1.5" /></div>
    <Field label={t('admin.settings.link1Rule')} help={t('admin.settings.link1RuleHint', { modelId: '{modelId}' })} status={states.link1Rule}><textarea className="w-full rounded-lg border bg-background p-2" value={form.link1Rule ?? ''} onChange={(event) => change('link1Rule', event.target.value)} onBlur={(event) => commit('link1Rule', event.target.value)} placeholder="https://openwebui.example/" /></Field>
  </section>
}
/** 도구 전달은 라디오를 바꾸는 즉시 그 값만 PATCH한다 */
function OwuiToolsForm({ initial }: { initial: Settings }) {
  const t = useT()
  const headingId = useId()
  const client = useQueryClient()
  const [value, setValue] = useState(initial.owuiTools ?? 'auto')
  const saved = useRef(value)
  const { states, run } = useAutoSave<'owuiTools'>()
  function commit(next: 'auto' | 'off') {
    setValue(next)
    if (next === saved.current) return
    void run('owuiTools', async () => { await saveSettings({ owuiTools: next }); saved.current = next; await client.invalidateQueries({ queryKey: ['settings'] }) })
  }
  return <section aria-labelledby={headingId} className="space-y-3 rounded-xl border bg-card p-4 text-sm">
    <h2 id={headingId} className="font-semibold">{t('admin.settings.owuiTools')}</h2>
    <fieldset aria-labelledby={headingId}>
      <RadioGroup aria-label={t('admin.settings.owuiTools')} value={value} onValueChange={value => commit(value as 'auto' | 'off')} disabled={states.owuiTools?.status === 'saving'}>
        {(['auto', 'off'] as const).map(option => <label key={option} className="flex cursor-pointer items-center gap-2"><RadioGroupItem value={option} />{t(option === 'auto' ? 'admin.settings.owuiAuto' : 'admin.settings.owuiOff')}</label>)}
      </RadioGroup>
    </fieldset>
    <p className="text-xs text-muted-foreground">{t('admin.settings.owuiHint')}</p>
    <SaveStatus state={states.owuiTools} />
  </section>
}

/** AI 도우미 캐릭터(알약 이미지) — SO 업로드·교체·제거. 저장소에는 넣지 않고 서버 파일로만 둔다(U4) */
function AssistantImageForm({ fileId }: { fileId: string | null | undefined }) {
  const t = useT()
  const headingId = useId()
  const client = useQueryClient()
  const [busy, setBusy] = useState(false)
  async function save(file: File | null) {
    setBusy(true)
    try {
      await uploadAssistantImage(file)
      await client.invalidateQueries({ queryKey: ['settings'] })
      toast.success(t(file ? 'admin.settings.assistantImageSaved' : 'admin.settings.assistantImageRemoved'))
    } catch (error) { toast.error(error instanceof Error ? error.message : t('admin.settings.assistantImageFailed')) }
    finally { setBusy(false) }
  }
  return <section aria-labelledby={headingId} className="space-y-3 rounded-xl border bg-card p-4 text-sm">
    <h2 id={headingId} className="font-semibold">{t('admin.settings.assistantImage')}</h2>
    <div className="flex flex-wrap items-center gap-3">
      <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary text-primary-foreground">
        {fileId ? <img src={`/api/settings/assistant-image?v=${encodeURIComponent(fileId)}`} alt={t('pill.characterAlt')} className="size-full object-cover" /> : <Sparkles className="size-5" aria-hidden />}
      </span>
      <Field label={t('admin.settings.assistantImageChoose')} className="[&>label]:cursor-pointer [&>label]:rounded-lg [&>label]:border [&>label]:px-2 [&>label]:py-1">
        <input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void save(file) }} />
      </Field>
      {fileId && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void save(null)}>{t('admin.settings.assistantImageRemove')}</Button>}
    </div>
    <p className="text-xs text-muted-foreground">{t('admin.settings.assistantImageHint')}</p>
  </section>
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
    {query.data ? <div className="space-y-4"><SettingsForm initial={query.data} /><OwuiToolsForm initial={query.data} /><AssistantImageForm fileId={query.data.assistantImageFileId} /></div> : <p>{t('admin.settings.loading')}</p>}
    <AiSummary />
  </div></div></>
}
