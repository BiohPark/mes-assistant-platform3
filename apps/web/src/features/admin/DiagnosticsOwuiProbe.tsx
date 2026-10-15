import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { OWUI_PROBE_MASKED, OWUI_PROBE_OTHER, type OwuiAccessCheck, type OwuiProbeAccessListResult, type OwuiProbeAttemptResult, type OwuiProbeReport, type OwuiProbeSessionResult } from '@mes/contracts'
import { probeOpenWebUi } from '@/api/admin'
import { ModelSelect } from '@/components/ModelSelect'
import { Button } from '@/components/ui/button'
import { copyText } from '@/lib/clipboard'
import { useT, type Translator } from '@/i18n'

function attemptLine(attempt: OwuiProbeAttemptResult, t: Translator): string {
  return [attempt.status === null ? t('admin.diagnostics.probe.noResponse') : `HTTP ${attempt.status}`,
    ...(attempt.firstByteMs === null ? [] : [t('admin.diagnostics.probe.firstByte', { ms: String(attempt.firstByteMs) })]),
    ...(attempt.firstContentMs === null ? [] : [t('admin.diagnostics.probe.firstContent', { ms: String(attempt.firstContentMs) })]),
    t('admin.diagnostics.probe.total', { ms: String(attempt.totalMs) }),
    ...(attempt.error ? [attempt.error] : [])].join(' · ')
}

function sessionLine(session: OwuiProbeSessionResult, t: Translator): string {
  const cleanup = session.cleanup === null ? 'cleanupNone' : session.cleanup ? 'cleanupOk' : 'cleanupFailed'
  return [session.status === null ? t('admin.diagnostics.probe.noResponse') : `HTTP ${session.status}`,
    ...(session.firstStatusMs === null ? [] : [t('admin.diagnostics.probe.firstStatus', { ms: String(session.firstStatusMs) })]),
    ...(session.doneMs === null ? [] : [t('admin.diagnostics.probe.done', { ms: String(session.doneMs) })]),
    t('admin.diagnostics.probe.total', { ms: String(session.totalMs) }), t(`admin.diagnostics.probe.${cleanup}`),
    ...(session.error ? [session.error] : [])].join(' · ')
}

const maskedId = (id: string, t: Translator) => id === OWUI_PROBE_MASKED ? t('admin.diagnostics.probe.masked') : id
/** ✅ · ❌ · 확인 불가 */
const mark = (ok: boolean | null, t: Translator) => ok === null ? t('admin.diagnostics.probe.unknown') : ok ? '✅' : '❌'

function accessLine(list: OwuiProbeAccessListResult, t: Translator): string {
  const state = { ok: '✅', denied: '❌', inactive: `❌ ${t('admin.diagnostics.probe.inactive')}`, unknown: t('admin.diagnostics.probe.unknown') }
  const items = list.items.length ? list.items.map((item) => `${maskedId(item.id, t)} ${state[item.state]}`).join(', ') : t('admin.diagnostics.probe.none')
  return list.error ? `${items} · ${t('admin.diagnostics.probe.unknown')} (${list.error})`
    : list.visible === null ? items : `${items} · ${t('admin.diagnostics.probe.visible', { count: String(list.visible) })}`
}

/** 서비스 계정 접근·권한·주입 조건 행 — 진단 카드와 에이전트 연결 확인이 같이 쓴다(S13-J). 이름·불린만 담긴다 */
export function accessRows(result: Pick<OwuiAccessCheck, 'meta' | 'access' | 'account' | 'fetchUrl'>, t: Translator): [string, string][] {
  const builtin = Object.entries(result.meta.builtinTools)
  const { account } = result
  return [
    [t('admin.diagnostics.probe.toolAccess'), accessLine(result.access.tools, t)],
    [t('admin.diagnostics.probe.skillAccess'), accessLine(result.access.skills, t)],
    ['builtinTools', builtin.length ? builtin.map(([name, on]) => `${name} ${on ? t('admin.diagnostics.probe.on') : t('admin.diagnostics.probe.off')}`).join(' · ') : t('admin.diagnostics.probe.builtinDefault')],
    [t('admin.diagnostics.probe.terminal'), result.meta.terminal ? t('admin.diagnostics.probe.terminalSet') : t('admin.diagnostics.probe.none')],
    [t('admin.diagnostics.probe.knowledge'), `${t('common.items', { count: result.meta.knowledgeCount })} ${t('admin.diagnostics.probe.appliedByOwui')}`],
    [t('admin.diagnostics.probe.account'), [account.role ?? t('admin.diagnostics.probe.unknown'), ...Object.entries(account.features).map(([name, ok]) => `${name} ${mark(ok, t)}`)].join(' · ')
      + (account.error ? ` (${account.error})` : '')],
    [t('admin.diagnostics.probe.fetchUrl'), result.fetchUrl.map((condition) => `${condition.name} ${condition.name === 'features.web_search' && result.meta.capabilities.web_search === true ? t('admin.diagnostics.probe.urlAuto') : mark(condition.ok, t)}`).join(' · ') || '—'],
  ]
}

/** 화면 요약과 복사 텍스트가 같은 행을 쓴다 — 결과 스키마에 있는 값만 담긴다 */
function probeRows(result: OwuiProbeReport, t: Translator): [string, string][] {
  // 허용 목록 밖 표기((가림)·기타)는 화면 언어로 바꿔 보여 준다
  const other = (value: string) => value.replaceAll(OWUI_PROBE_OTHER, t('admin.diagnostics.probe.other'))
  const list = (items: string[]) => items.length ? items.map((id) => maskedId(id, t)).join(', ') : t('admin.diagnostics.probe.none')
  const caps = Object.entries(result.meta.capabilities)
  const attempt = (mode: OwuiProbeAttemptResult['mode']) => result.attempts.find((item) => item.mode === mode)
  const rows: [string, string][] = [
    [t('admin.diagnostics.probe.version'), result.version ?? t('admin.diagnostics.probe.unknown')],
    [t('admin.diagnostics.probe.model'), result.model],
    [t('admin.diagnostics.probe.meta'), result.meta.found ? t('admin.diagnostics.probe.metaFound')
      : `${t('admin.diagnostics.probe.metaMissing')}${result.meta.error ? ` (${result.meta.error})` : ''}`],
    ['toolIds', list(result.meta.toolIds)],
    ['defaultFeatureIds', list(result.meta.defaultFeatureIds)],
    ['capabilities', caps.length ? caps.map(([name, on]) => `${name} ${on ? t('admin.diagnostics.probe.on') : t('admin.diagnostics.probe.off')}`).join(' · ') : t('admin.diagnostics.probe.none')],
    ['function_calling', result.meta.functionCalling === null ? t('admin.diagnostics.probe.notSet') : other(result.meta.functionCalling)],
    ...accessRows(result, t),
  ]
  for (const [mode, label, frames] of [['current', 'admin.diagnostics.probe.current', 'admin.diagnostics.probe.framesCurrent'], ['legacy', 'admin.diagnostics.probe.legacy', 'admin.diagnostics.probe.framesLegacy']] as const) {
    const item = attempt(mode)
    if (!item) continue
    rows.push([t(label), attemptLine(item, t)], [t(frames), other(item.frames.join(' → ')) || '—'])
  }
  rows.push([t('admin.diagnostics.probe.session'), sessionLine(result.session, t)], [t('admin.diagnostics.probe.framesSession'), other(result.session.statuses.join(' → ')) || '—'])
  rows.push([t('admin.diagnostics.probe.elapsed'), `${result.ms} ms`])
  return rows
}

export function formatOwuiProbe(result: OwuiProbeReport, t: Translator): string {
  return [t('admin.diagnostics.probe.title'), ...probeRows(result, t).map(([name, value]) => `${name}: ${value}`)].join('\n')
}

/** SO 전용 OpenWebUI 진단 — 버튼 하나, 결과는 캡처 한 장에 담기는 요약 카드 (S10-5) */
export function OwuiProbeCard({ live, defaultModel }: { live: boolean; defaultModel: string }) {
  const t = useT()
  const [model, setModel] = useState(defaultModel)
  const probe = useMutation({ mutationFn: probeOpenWebUi })
  const result = probe.data
  return <section aria-label={t('admin.diagnostics.probe.title')} className="rounded-xl border bg-card p-4">
    <h2 className="mb-1 font-semibold">{t('admin.diagnostics.probe.title')}</h2>
    <p className="mb-3 text-xs text-muted-foreground">{t('admin.diagnostics.probe.hint')}</p>
    <div className="flex flex-wrap items-center gap-2">
      <ModelSelect value={model} onChange={setModel} aria-label={t('admin.diagnostics.probe.modelLabel')} disabled={probe.isPending} className="w-full max-w-sm" />
      <Button variant="outline" size="sm" disabled={!live || !model.trim() || probe.isPending} onClick={() => probe.mutate(model.trim())}>
        {probe.isPending ? t('admin.diagnostics.probe.running') : t('admin.diagnostics.probe.run')}
      </Button>
    </div>
    {!live && <p className="mt-2 text-sm text-muted-foreground">{t('admin.diagnostics.probe.liveOnly')}</p>}
    {probe.isError && <p role="alert" className="mt-2 text-sm text-destructive">{t('admin.diagnostics.probe.failed', { error: probe.error.message })}</p>}
    {result && !probe.isPending && <div className="mt-3 rounded-lg border bg-muted/30 p-3">
      <div role="status">
        <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-3 gap-y-1 text-sm">
          {probeRows(result, t).map(([name, value], index) => <div className="contents" key={index}><dt className="text-muted-foreground">{name}</dt><dd className="break-all font-mono text-xs leading-5">{value}</dd></div>)}
        </dl>
      </div>
      <Button variant="outline" size="sm" className="mt-3" onClick={() => void copyText(formatOwuiProbe(result, t)).then((ok) => toast[ok ? 'success' : 'error'](ok ? t('admin.diagnostics.copied') : t('admin.diagnostics.copyFailed')))}>
        {t('admin.diagnostics.probe.copy')}
      </Button>
    </div>}
  </section>
}
