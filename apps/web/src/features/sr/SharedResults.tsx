import { useT } from '@/i18n'
import { useQueries } from '@tanstack/react-query'
import type { SharedResult } from '@mes/domain'
import { Markdown } from '@/components/Markdown'
import { useDates } from '@/lib/dates'

function Result({ result }: { result: SharedResult }) {
  const t = useT()
  const { formatDateTime } = useDates()
  const files = useQueries({ queries: result.fileIds.map(id => ({ queryKey: ['file', id], queryFn: async () => {
    const response = await fetch(`/api/files/${encodeURIComponent(id)}`, { credentials: 'same-origin' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json() as Promise<{ name: string }>
  }, retry: false })) })
  return <article className="space-y-2 rounded-lg border p-3 text-sm">
    <p className="text-xs text-muted-foreground">{t('sr.sharedBy', { name: result.byName || t('sr.unknownSharer'), at: formatDateTime(result.at) })}</p>
    {result.text && <Markdown content={result.text} />}
    {result.fileIds.map((id, index) => <a key={id} className="block text-primary underline" href={`/api/files/${encodeURIComponent(id)}/content`} download>{files[index]?.data?.name || t('sr.sharedFile', { number: index + 1 })}</a>)}
  </article>
}

export function SharedResults({ results }: { results: SharedResult[] }) {
  const t = useT()
  return <section className="space-y-2"><h3 className="font-medium">{t('sr.sharedResults')}</h3>
    {results.length === 0 && <p className="text-sm text-muted-foreground">{t('sr.noResults')}</p>}
    {results.map(result => <Result key={result.id} result={result} />)}
  </section>
}
