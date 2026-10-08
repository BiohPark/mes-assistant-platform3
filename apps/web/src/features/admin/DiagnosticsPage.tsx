import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { LlmTestConnection } from '@mes/contracts'
import { LlmTestError, testConnection } from '@/api/llm'
import { TopBar } from '@/app/TopBar'
import { AgentTestChat } from '@/components/AgentTestChat'
import { ModelSelect } from '@/components/ModelSelect'
import { Button } from '@/components/ui/button'
import { copyText } from '@/lib/clipboard'
import { useT, type Translator } from '@/i18n'

type Diagnostics = {
  app: { version: string; commit: string; builtAt: string; node: string; os: string }
  db: { version: string; charset: string; collation: string; migrations: number | null; error?: string }
  llm: { mode: string; preset: string; baseUrlHost: string; defaultModel: string; ok: boolean; detail: string; ms: number }
  storage: { path: string; writable: boolean; freeBytes: number | null }
  trustProxy: false | number | string[]
  settings: { authMode: string; apiPort: number; fileMaxBytes: number; fileMaxPerRequest: number; requestMaxActive: number }
  secrets: { databasePassword: boolean; sessionSecret: boolean; llmApiKey: boolean; oidcClientSecret: boolean; devUserPassword: boolean }
  recentErrors: { at: string; path: string; status: number; message: string }[]
}

function rows(data: Diagnostics, t: Translator): [string, string][] {
  const set = (value: boolean) => value ? t('admin.diagnostics.configured') : t('admin.diagnostics.missing')
  return [
    [t('admin.diagnostics.appVersion'), data.app.version], [t('admin.diagnostics.commit'), data.app.commit], [t('admin.diagnostics.builtAt'), data.app.builtAt], ['Node', data.app.node], ['OS', data.app.os],
    [t('admin.diagnostics.dbVersion'), data.db.version || data.db.error || t('admin.diagnostics.lookupFailed')], [t('admin.diagnostics.dbCharset'), data.db.charset], [t('admin.diagnostics.dbCollation'), data.db.collation],
    [t('admin.diagnostics.migrations'), data.db.migrations === null ? t('admin.diagnostics.lookupFailed') : String(data.db.migrations)],
    [t('admin.diagnostics.llmMode'), data.llm.mode], [t('admin.diagnostics.llmPreset'), data.llm.preset], [t('admin.diagnostics.llmHost'), data.llm.baseUrlHost],
    [t('admin.defaultModel'), data.llm.defaultModel], [t('admin.diagnostics.llmConnection'), t('admin.diagnostics.llmResult', { result: data.llm.ok ? t('admin.diagnostics.success') : t('admin.diagnostics.failure'), ms: String(data.llm.ms), detail: data.llm.detail })],
    [t('admin.diagnostics.storagePath'), data.storage.path], [t('admin.diagnostics.storageWritable'), data.storage.writable ? t('admin.diagnostics.writable') : t('admin.diagnostics.notWritable')],
    [t('admin.diagnostics.freeSpace'), data.storage.freeBytes === null ? t('admin.diagnostics.lookupFailed') : `${data.storage.freeBytes} bytes`],
    ['TRUST_PROXY', Array.isArray(data.trustProxy) ? data.trustProxy.join(', ') : String(data.trustProxy)],
    [t('admin.diagnostics.authMode'), data.settings.authMode], [t('admin.diagnostics.apiPort'), String(data.settings.apiPort)],
    [t('admin.diagnostics.fileMaxBytes'), String(data.settings.fileMaxBytes)], [t('admin.fileMaxPerRequest'), String(data.settings.fileMaxPerRequest)],
    [t('admin.diagnostics.requestMaxActive'), String(data.settings.requestMaxActive)],
    [t('admin.diagnostics.databasePassword'), set(data.secrets.databasePassword)], ['SESSION_SECRET', set(data.secrets.sessionSecret)],
    ['LLM_API_KEY', set(data.secrets.llmApiKey)], ['OIDC_CLIENT_SECRET', set(data.secrets.oidcClientSecret)],
    ['DEV_USER_PASSWORD', set(data.secrets.devUserPassword)],
  ]
}

export function formatDiagnostics(data: Diagnostics, t: Translator): string {
  return [...rows(data, t).map(([name, value]) => `${name}: ${value}`), '', t('admin.diagnostics.recentErrors'),
    ...data.recentErrors.map((error) => `${error.at} ${error.path} ${error.status} ${error.message}`)].join('\n')
}

/** AI 연결 카드 — .env 값의 표시와 연결 시험만 한다(주소·모드·키 편집 없음) */
function AiConnectionCard({ data }: { data: Diagnostics }) {
  const t = useT()
  const test = useMutation({ mutationFn: testConnection })
  const line = (key: 'admin.diagnostics.modelsLine' | 'admin.diagnostics.completionLine', result: LlmTestConnection['models'] | LlmTestConnection['completion'], detail: string) =>
    t(key, { result: result.ok ? t('admin.diagnostics.resultOk', { detail, ms: String(result.ms) }) : t('admin.diagnostics.resultFail', { error: result.error ?? '' }) })
  const cells: [string, string][] = [
    [t('admin.diagnostics.mode'), data.llm.mode === 'mock' ? 'Mock' : 'Live'],
    [t('admin.diagnostics.presetHost'), `${data.llm.preset} · ${data.llm.baseUrlHost || '—'}`],
    [t('admin.diagnostics.defaultModelEnv'), data.llm.defaultModel || '—'],
    [t('admin.diagnostics.apiKey'), data.secrets.llmApiKey ? t('admin.diagnostics.configured') : t('admin.diagnostics.missing')],
  ]
  return <section aria-label={t('admin.diagnostics.aiConnection')} className="rounded-xl border bg-card p-4">
    <h2 className="mb-3 font-semibold">{t('admin.diagnostics.aiConnection')}</h2>
    <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">{cells.map(([name, value]) => <div key={name} className="min-w-0"><dt className="text-xs text-muted-foreground">{name}</dt><dd aria-label={name} className="truncate font-medium">{value}</dd></div>)}</dl>
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" disabled={test.isPending} onClick={() => test.mutate()}>{test.isPending ? t('admin.diagnostics.testing') : t('admin.diagnostics.testConnection')}</Button>
      {test.data && <p role="status" className="text-sm">
        <span className="block">{line('admin.diagnostics.modelsLine', test.data.models, t('common.items', { count: test.data.models.count }))}</span>
        <span className="block">{line('admin.diagnostics.completionLine', test.data.completion, test.data.completion.model)}</span>
      </p>}
      {test.isError && <p role="alert" className="text-sm text-destructive">{t('admin.diagnostics.testFailed', { status: test.error instanceof LlmTestError ? String(test.error.status) : test.error.message })}</p>}
    </div>
    <p className="mt-3 text-xs text-muted-foreground">{t('admin.diagnostics.envGuide')}</p>
  </section>
}

function TestChatSection() {
  const t = useT()
  const [model, setModel] = useState('')
  return <section aria-label={t('admin.diagnostics.testChat')} className="rounded-xl border bg-card p-4">
    <h2 className="mb-3 font-semibold">{t('admin.diagnostics.testChat')}</h2>
    <ModelSelect value={model} onChange={setModel} className="mb-3 max-w-sm" />
    <AgentTestChat modelId={model} showDiagnosticsLink={false} />
  </section>
}

export function DiagnosticsPage() {
  const t = useT()
  const query = useQuery<Diagnostics>({ queryKey: ['diagnostics'], queryFn: async () => {
    const response = await fetch('/api/admin/diagnostics', { credentials: 'same-origin' })
    if (!response.ok) throw new Error(t('admin.diagnostics.fetchFailed', { status: String(response.status) }))
    return response.json() as Promise<Diagnostics>
  } })
  return <><TopBar title={t('nav.diagnostics')} /><div className="flex-1 overflow-auto p-4"><div className="mx-auto max-w-3xl space-y-4">
    {query.data && <AiConnectionCard data={query.data} />}
    <div className="flex gap-2"><Button variant="outline" onClick={() => void query.refetch()}>{t('admin.diagnostics.recheck')}</Button>
      <Button disabled={!query.data} onClick={() => { if (query.data) void copyText(formatDiagnostics(query.data, t)).then((ok) => toast[ok ? 'success' : 'error'](ok ? t('admin.diagnostics.copied') : t('admin.diagnostics.copyFailed'))) }}>{t('admin.diagnostics.copyText')}</Button></div>
    {query.isError && <p role="alert">{t('admin.diagnostics.loadFailed')}</p>}
    {query.data && <><section className="rounded-xl border bg-card p-4"><h2 className="mb-3 font-semibold">{t('admin.diagnostics.environment')}</h2>
      <dl className="grid grid-cols-[minmax(10rem,1fr)_2fr] gap-2 text-sm">{rows(query.data, t).map(([name, value]) => <div className="contents" key={name}><dt className="text-muted-foreground">{name}</dt><dd className="break-all">{value}</dd></div>)}</dl>
    </section><section className="rounded-xl border bg-card p-4"><h2 className="mb-3 font-semibold">{t('admin.diagnostics.recentErrors')}</h2>
      {query.data.recentErrors.length ? <ul className="space-y-2 text-sm">{query.data.recentErrors.map((error, index) => <li key={`${error.at}-${index}`}>{error.at} · {error.path} · {error.status} · {error.message}</li>)}</ul> : <p className="text-sm text-muted-foreground">{t('admin.diagnostics.noErrors')}</p>}
    </section></>}
    <TestChatSection />
  </div></div></>
}
