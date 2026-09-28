import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useUiStore } from '@/app/uiStore'

const ALL = '__all__'

interface CardMapFilterBarProps {
  level1Options: { id: string; label: string }[]
  /** 현재 Lv1에 속한 Lv2 (Lv1 미선택이면 빈 배열) */
  level2Options: { id: string; label: string }[]
  level1CodeId: string | null
  level2CodeId: string | null
}

export function CardMapFilterBar({ level1Options, level2Options, level1CodeId, level2CodeId }: CardMapFilterBarProps) {
  const filters = useUiStore((s) => s.homeFilters)
  const setFilters = useUiStore((s) => s.setHomeFilters)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full sm:w-64">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input value={filters.q} onChange={(e) => setFilters({ q: e.target.value })} placeholder="이름 · 요약 · 업무 분류 검색" className="h-8 pl-8" />
      </div>
      <ToggleGroup type="single" variant="outline" size="sm" value={level1CodeId ?? ''} onValueChange={(v) => setFilters({ level1CodeId: v || null })} className="flex-wrap">
        {level1Options.map((lv) => (
          <ToggleGroupItem key={lv.id} value={lv.id}>
            {lv.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {level1CodeId && level2Options.length > 0 && (
        <Select value={level2CodeId ?? ALL} onValueChange={(v) => setFilters({ level2CodeId: v === ALL ? null : v })}>
          <SelectTrigger size="sm" className="w-40" aria-label="업무 Lv2">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{level1Options.find((option) => option.id === level1CodeId)?.label} 전체</SelectItem>
            {level2Options.map((lv) => (
              <SelectItem key={lv.id} value={lv.id}>
                {lv.label}
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
