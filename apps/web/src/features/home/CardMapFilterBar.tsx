import { Check, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useT } from '@/i18n'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
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
export function CardMapFilterBar({ level1Options, level2Options, filters, onChange, onReset }: CardMapFilterBarProps) {
  const t = useT()
  const search = useSearchText(filters.q, q => onChange({ q }))
  const count = filters.level1CodeIds.length + filters.level2CodeIds.length + Number(filters.showRetired)
  return <div className="flex flex-wrap items-center gap-2">
    <div className="relative w-full sm:w-64">
      <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input {...search} aria-label={t('hub.searchAssistants')} placeholder={t('hub.searchAssistants')} className="h-8 pl-8" />
    </div>
    {(['level1', 'level2'] as const).map(level => {
      const options = level === 'level1' ? level1Options : level2Options
      const values = level === 'level1' ? filters.level1CodeIds : filters.level2CodeIds
      return options.length > 0 && <ToggleGroup key={level} type="multiple" variant="outline" size="sm" value={values} onValueChange={ids => onChange(level === 'level1' ? { level1CodeIds: ids } : { level2CodeIds: ids })} aria-label={t(level === 'level1' ? 'hub.level1Filter' : 'hub.level2Filter')} className="flex-wrap">
        {options.map(option => <ToggleGroupItem key={option.id} value={option.id} className={FILTER_TOGGLE_CLASS}>{values.includes(option.id) && <Check aria-hidden className="size-3" />}{option.label}</ToggleGroupItem>)}
      </ToggleGroup>
    })}
    <Label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground"><Switch checked={filters.showRetired} onCheckedChange={showRetired => onChange({ showRetired })} />{t('hub.showRetired')}</Label>
    <span className="text-xs text-muted-foreground">{t('hub.selectedCount', { count })}</span>
    <Button size="sm" variant="ghost" disabled={!count && !filters.q} onClick={onReset}>{t('hub.reset')}</Button>
  </div>
}
