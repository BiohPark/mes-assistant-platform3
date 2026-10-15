import { useT } from '@/i18n'
import { MODEL_SOURCE_KEY } from '@/lib/labels'
import { use, useState } from 'react'
import { useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Check, ChevronDown, Cpu, RefreshCw, Settings2 } from 'lucide-react'
import { toast } from 'sonner'
import { resolveModel, type Task } from '@mes/domain'
import type { Assistant } from '@mes/contracts'
import { setTaskModel } from '@/api/tasks'
import { getSettings } from '@/api/admin'
import { MeContext } from '@/app/auth'
import { useActor, useUserMap } from '@/app/hooks'
import { assistantLink1 } from '@/lib/links'
import { OpenWebUiIcon } from '@/components/OpenWebUiIcon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useModelList } from '@/lib/useModelList'
import { cn } from '@/lib/utils'

/**
 * 대화 모델 지정은 task.modelId에 저장한다. 스레드별 모델 지정은 S3에서 연결한다. 입력창 아래에 놓이므로 목록은 위로 펼친다.
 * 팝오버 맨 위는 '필요한 순간' 안내(S13-R): 여기서 바꾼 모델은 이 대화에만 적용되고, 에이전트 설정 자체는 SO가 [에이전트 설정 열기]로(편집 시트의 모델 항목을 '여기예요'로 짚음), 비SO는 담당자·SO에게.
 */
export function ModelPicker({ task, assistant, disabled }: { task: Task; assistant: Assistant; disabled?: boolean }) {
  const t = useT()
  const actor = useActor()
  const navigate = useNavigate()
  const owner = use(MeContext)?.roles.includes('system_owner') ?? false
  const ownerName = useUserMap().get(assistant.ownerId)?.name
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState('')
  const [saving, setSaving] = useState(false)
  const { models, loading, reload, error } = useModelList()
  const settings = useQuery({ queryKey: ['settings'], queryFn: getSettings }).data
  const resolved = resolveModel({ task, assistant, settings: { model: settings?.defaultModel ?? '' } })
  const current = task.modelId ?? ''
  const missingOnServer = models.length > 0 && !!resolved.modelId && !models.includes(resolved.modelId)
  const link1 = assistantLink1('', assistant, settings?.link1Rule) // 대화 헤더의 OpenWebUI 바로가기와 같은 규칙
  async function choose(modelId: string) {
    setSaving(true)
    try {
      await setTaskModel(actor, task.id, modelId)
      toast.success(modelId ? t('chat.modelSet', { model: modelId }) : t('chat.modelCleared'))
      setOpen(false)
      setCustom('')
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : t('chat.modelSaveFailed')) }
    finally { setSaving(false) }
  }
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><button type="button" data-tour="model" disabled={disabled} className={cn('inline-flex h-6 max-w-[60vw] items-center truncate gap-1 rounded-full border bg-background px-1.5 font-mono text-xs text-muted-foreground hover:bg-muted hover:text-foreground sm:max-w-72', missingOnServer && 'border-tone-warning-fg text-tone-warning-fg')} title={t('chat.changeModel')}><Cpu className="size-3 shrink-0" /><span className="min-w-0 truncate">{resolved.modelId || t('chat.noModel')}</span><span className="shrink-0 text-xs opacity-70">{t(MODEL_SOURCE_KEY[resolved.source])}</span>{missingOnServer && <AlertTriangle className="size-3 shrink-0" />}<ChevronDown className="size-3 shrink-0 opacity-60" /></button></PopoverTrigger>
    <PopoverContent side="top" align="start" aria-label={t('chat.assistantModel')} className="w-[min(22rem,calc(100vw-2rem))]">
      <div className="mb-2 space-y-1.5 rounded-xl border bg-muted/30 p-2 text-xs leading-relaxed">
        <p className="font-medium">{t('chat.modelScopeNotice')}</p>
        <p className="text-muted-foreground">{owner ? t('chat.modelSettingsQuestion') : ownerName ? t('chat.modelSettingsByOwner', { owner: ownerName }) : t('chat.modelSettingsByOwnerUnknown')}</p>
        {(owner || link1) && <div className="flex flex-wrap gap-1.5">
          {owner && <Button type="button" size="xs" variant="outline" onClick={() => { setOpen(false); void navigate(`/assistants/manage?edit=${encodeURIComponent(assistant.id)}&point=model`) }}><Settings2 data-icon="inline-start" />{t('chat.openAgentSettings')}</Button>}
          {link1 && <Button size="xs" variant="outline" asChild><a href={link1} target="_blank" rel="noreferrer">{t('chat.openWebUi')}<OpenWebUiIcon data-icon="inline-end" /></a></Button>}
        </div>}
      </div>
      <div className="mb-2 flex items-center justify-between"><div className="text-xs font-semibold">{t('chat.assistantModel')}</div><Button variant="ghost" size="icon" aria-label={t('chat.reloadModels')} onClick={() => void reload()} disabled={loading}><RefreshCw className={cn(loading && 'animate-spin')} /></Button></div>
      <div className="mb-2 rounded-xl border bg-muted p-2 break-all text-xs leading-relaxed text-muted-foreground"><span className={cn(current && 'font-semibold text-foreground')}>{t('chat.thisConversation')} <span className="font-mono">{current || '–'}</span></span><span className="mx-1 opacity-50">›</span><span className={cn(!current && assistant.modelId && 'font-semibold text-foreground')}>{t('chat.agentMapping')} <span className="font-mono">{assistant.modelId || '–'}</span></span></div>
      {missingOnServer && <p className="mb-2 rounded-xl border border-tone-warning-fg bg-tone-warning-bg p-1.5 text-xs text-tone-warning-fg">{t('chat.modelMissingBefore')} <code className="break-all">{resolved.modelId}</code>{t('chat.modelMissingAfter')}</p>}
      <ul className="max-h-44 space-y-0.5 overflow-y-auto"><li><button type="button" disabled={saving} onClick={() => void choose('')} className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-xs hover:bg-muted">{!current ? <Check className="size-3" /> : <span className="size-3" />}{t('chat.useDefaultModel')} <span className="text-muted-foreground">{t('chat.agentMappingHint')}</span></button></li>{models.map((model) => <li key={model}><button type="button" disabled={saving} onClick={() => void choose(model)} className="flex w-full items-center gap-2 min-w-0 rounded-lg px-2 py-1 text-left font-mono text-xs hover:bg-muted">{current === model ? <Check className="size-3" /> : <span className="size-3" />}<span className="min-w-0 truncate" title={model}>{model}</span></button></li>)}{!loading && (error || models.length === 0) && <li className="px-2 py-1 text-xs text-muted-foreground">{t('chat.noModels')}</li>}</ul>
      <form className="mt-2 flex gap-1" onSubmit={(event) => { event.preventDefault(); if (custom.trim()) void choose(custom.trim()) }}><Input value={custom} onChange={(event) => setCustom(event.target.value)} placeholder={t('chat.customModel')} className="h-7 font-mono text-xs" /><Button type="submit" size="sm" disabled={!custom.trim() || saving}>{t('chat.apply')}</Button></form>
    </PopoverContent>
  </Popover>
}
