import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useUiStore } from '@/app/uiStore'

const ALL = '__all__'

interface CardMapFilterBarProps {
  level1Options: string[]
  /** 현재 Lv1에 속한 Lv2 (Lv1 미선택이면 빈 배열) */
  level2Options: string[]
}

export function CardMapFilterBar({ level1Options, level2Options }: CardMapFilterBarProps) {
  const filters = useUiStore((s) => s.homeFilters)
  const setFilters = useUiStore((s) => s.setHomeFilters)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full sm:w-64">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input value={filters.q} onChange={(e) => setFilters({ q: e.target.value })} placeholder="이름 · 요약 · 업무 분류 검색" className="h-8 pl-8" />
      </div>
      <ToggleGroup type="single" variant="outline" size="sm" value={filters.level1 ?? ''} onValueChange={(v) => setFilters({ level1: v || null })} className="flex-wrap">
        {level1Options.map((lv) => (
          <ToggleGroupItem key={lv} value={lv}>
            {lv}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {filters.level1 && level2Options.length > 0 && (
        <Select value={filters.level2 ?? ALL} onValueChange={(v) => setFilters({ level2: v === ALL ? null : v })}>
          <SelectTrigger size="sm" className="w-40" aria-label="업무 Lv2">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{filters.level1} 전체</SelectItem>
            {level2Options.map((lv) => (
              <SelectItem key={lv} value={lv}>
                {lv}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
        <Switch checked={filters.showRetired} onCheckedChange={(v) => setFilters({ showRetired: v })} />
        폐기 표시
      </Label>
    </div>
  )
}
