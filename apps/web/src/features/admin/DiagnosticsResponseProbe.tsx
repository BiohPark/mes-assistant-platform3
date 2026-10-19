import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { probeOpenWebUiResponse } from '@/api/admin'
import { ModelSelect } from '@/components/ModelSelect'
import { Button } from '@/components/ui/button'
import { ResponseDiagnosticColumns } from '@/features/chat/ResponseDiagnosticColumns'
import { copyText } from '@/lib/clipboard'
import { useT } from '@/i18n'

export function ResponseProbeCard({ live, defaultModel }: { live: boolean; defaultModel: string }) {
  const t = useT()
  const [model, setModel] = useState(defaultModel)
  const [copyFailed, setCopyFailed] = useState(false)
  const probe = useMutation({ mutationFn: probeOpenWebUiResponse })
  return <section aria-label={t('admin.diagnostics.responseProbe.title')} className="space-y-3 rounded-xl border bg-card p-4">
    <h2 className="font-semibold">{t('admin.diagnostics.responseProbe.title')}</h2>
    <p className="text-xs text-muted-foreground">{t('admin.diagnostics.responseProbe.hint')}</p>
    <div className="flex flex-wrap items-center gap-2">
      <ModelSelect value={model} onChange={setModel} aria-label={t('admin.diagnostics.probe.modelLabel')} disabled={probe.isPending} className="w-full max-w-sm" />
      <Button variant="outline" size="sm" disabled={!live || !model.trim() || probe.isPending} onClick={() => { setCopyFailed(false); probe.mutate(model.trim()) }}>
        {probe.isPending ? t('admin.diagnostics.responseProbe.running') : t('admin.diagnostics.responseProbe.run')}
      </Button>
    </div>
    {!live && <p className="text-sm text-muted-foreground">{t('admin.diagnostics.responseProbe.liveOnly')}</p>}
    {probe.isError && <p role="alert" className="text-sm text-destructive">{t('admin.diagnostics.probe.failed', { error: probe.error.message })}</p>}
    {probe.data && !probe.isPending && <>
      <p role="status" className="text-sm">{probe.data.mode} · {probe.data.model} · {probe.data.elapsedMs} ms</p>
      <ResponseDiagnosticColumns result={probe.data} />
      <Button variant="outline" size="sm" onClick={async () => setCopyFailed(!await copyText(JSON.stringify(probe.data, null, 2)))}>{t('chat.copyJson')}</Button>
      {copyFailed && <p role="alert">{t('chat.copyFailed')}</p>}
    </>}
  </section>
}
