import { Check, ChevronDown, Search, SlidersHorizontal, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useT } from '@/i18n'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { HomeFilters } from '@/app/uiStore'
import { useSearchText } from './useSearchText'

export const FILTER_TOGGLE_CLASS = 'border-muted-foreground/30 hover:border-foreground data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:font-semibold data-[state=on]:hover:bg-primary data-[state=on]:hover:text-primary-foreground aria-pressed:bg-primary disabled:opacity-50'
interface CardMapFilterBarProps {
  level1Options: { id: string; label: string }[]
  level2Options: { id: string; label: string }[]
  filters: HomeFilters
  onChange: (patch: Partial<HomeFilters>) => void
  onReset: () => void
}
/** 카드 화면 필터 — 보기 전환 줄(HomePage) 뒤에 이어 붙는 조각이라 fragment로 반환한다. 분류·필터는 팝오버, 고른 분류만 칩으로 보인다 */
export function CardMapFilterBar({ level1Options, level2Options, filters, onChange, onReset }: CardMapFilterBarProps) {
  const t = useT()
  const search = useSearchText(filters.q, q => onChange({ q }))
  const count = filters.level1CodeIds.length + filters.level2CodeIds.length + Number(filters.showRetired)
  const levels = [
    { level: 'level1', label: 'hub.level1Filter', options: level1Options, values: filters.level1CodeIds, patch: (ids: string[]) => ({ level1CodeIds: ids }) },
    { level: 'level2', label: 'hub.level2Filter', options: level2Options, values: filters.level2CodeIds, patch: (ids: string[]) => ({ level2CodeIds: ids }) },
  ] as const
  const selected = levels.flatMap(({ level, options, values, patch }) => options.filter(option => values.includes(option.id))
    .map(option => ({ key: `${level}:${option.id}`, label: option.label, remove: () => onChange(patch(values.filter(id => id !== option.id))) })))
  return <>
    <div className="relative w-full sm:w-64">
      <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input {...search} aria-label={t('hub.searchAssistants')} placeholder={t('hub.searchAssistants')} className="h-8 pl-8" />
    </div>
    <Popover>
      <PopoverTrigger asChild><Button size="sm" variant="outline" disabled={!level1Options.length && !level2Options.length}>{t('hub.classification')}<ChevronDown data-icon="inline-end" className="opacity-60" /></Button></PopoverTrigger>
      <PopoverContent align="start" aria-label={t('hub.classification')} className="w-[min(26rem,calc(100vw-2rem))] space-y-3">
        {levels.map(({ level, label, options, values, patch }) => options.length > 0 && <div key={level}>
          <div className="mb-1.5 text-xs font-semibold">{t(label)}</div>
          <ToggleGroup type="multiple" variant="outline" size="sm" value={values} onValueChange={ids => onChange(patch(ids))} aria-label={t(label)} className="flex-wrap">
            {options.map(option => <ToggleGroupItem key={option.id} value={option.id} className={FILTER_TOGGLE_CLASS}>{values.includes(option.id) && <Check aria-hidden className="size-3" />}{option.label}</ToggleGroupItem>)}
          </ToggleGroup>
        </div>)}
      </PopoverContent>
    </Popover>
    {selected.map(item => <span key={item.key} className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 text-xs">
      <span>{item.label}</span>
      <button type="button" aria-label={t('hub.removeClassification', { name: item.label })} onClick={item.remove} className="rounded-full hover:bg-primary/20"><X className="size-3" /></button>
    </span>)}
    <Popover>
      <PopoverTrigger asChild><Button size="sm" variant="outline"><SlidersHorizontal data-icon="inline-start" />{t('hub.filters')}</Button></PopoverTrigger>
      <PopoverContent align="start" aria-label={t('hub.filters')} className="w-56">
        <Label className="flex items-center gap-2 text-xs"><Switch checked={filters.showRetired} onCheckedChange={showRetired => onChange({ showRetired })} />{t('hub.showRetired')}</Label>
      </PopoverContent>
    </Popover>
    {(count > 0 || !!filters.q) && <div className="ml-auto flex items-center gap-2">
      {count > 0 && <span className="text-xs text-muted-foreground">{t('hub.selectedCount', { count })}</span>}
      <Button size="sm" variant="ghost" onClick={onReset}>{t('hub.reset')}</Button>
    </div>}
  </>
}
