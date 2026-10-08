import { useT } from '@/i18n'

/** 데모 charts.tsx 팔레트 순서. 추가 차트 의존성 없이 동일한 색을 쓴다. */
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'] as const

interface SeriesDef { key: string; name: string }
interface Props { data: ReadonlyArray<object>; xKey: string; series: SeriesDef[]; unit?: string; highlightMax?: boolean; stacked?: boolean }

export function BarsChart({ data, xKey, series, unit = '', highlightMax, stacked }: Props) {
  const t = useT()
  const rows = data as ReadonlyArray<Record<string, unknown>>
  const max = Math.max(1, ...rows.map((row) => stacked ? series.reduce((total, item) => total + Number(row[item.key] ?? 0), 0) : Math.max(...series.map((item) => Number(row[item.key] ?? 0)))))
  return <div className="space-y-2" role="img" aria-label={series.map((item) => item.name).join(', ')}>
    {rows.map((row, index) => <div key={index} className="flex items-center gap-2 text-xs">
      <span className="w-20 shrink-0 truncate text-muted-foreground" title={String(row[xKey])}>{String(row[xKey])}</span>
      {stacked ? <><div className="flex h-3 min-w-0 flex-1 overflow-hidden rounded-full bg-muted/40">{series.map((item, i) => <div key={item.key} title={`${item.name}: ${String(row[item.key] ?? 0)}`} style={{ width: `${Number(row[item.key] ?? 0) / max * 100}%`, backgroundColor: SERIES[i % SERIES.length] }} />)}</div><span className="w-6 text-right tabular-nums">{series.reduce((total, item) => total + Number(row[item.key] ?? 0), 0)}</span></> :
      <div className="flex min-w-0 flex-1 gap-0.5">
        {series.map((item, i) => <div key={item.key} className="flex items-center gap-1" style={{ width: `${Math.max(1, Number(row[item.key] ?? 0) / max * 100)}%` }}>
          <div className="h-3 min-w-0 flex-1 rounded-full" style={{ backgroundColor: highlightMax && Number(row[item.key] ?? 0) === max ? SERIES[1] : SERIES[i % SERIES.length] }} />
          <span className="tabular-nums">{String(row[item.key] ?? 0)}{unit}</span>
        </div>)}
      </div>
      }
    </div>)}
    {rows.length === 0 && <p className="text-xs text-muted-foreground">{t('reports.noChartData')}</p>}
    {series.length > 1 && <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">{series.map((item, i) => <span key={item.key} className="flex items-center gap-1"><span className="size-2 rounded-full" style={{ backgroundColor: SERIES[i % SERIES.length] }} />{item.name}</span>)}</div>}
  </div>
}
