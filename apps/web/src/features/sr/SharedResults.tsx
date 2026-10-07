import { useT } from '@/i18n'
import type { SharedResult } from '@mes/domain'
import { Markdown } from '@/components/Markdown'

export function SharedResults({ results }: { results: SharedResult[] }) {
  const t = useT()
  return <section className="space-y-2"><h3 className="font-medium">공유된 결과</h3>
    {results.length === 0 && <p className="text-sm text-muted-foreground">아직 공유된 결과가 없습니다.</p>}
    {results.map((result) => <article key={result.id} className="rounded-lg border p-3 text-sm">
      {result.text && <Markdown content={result.text} />}
      {result.fileIds.map((id, index) => <a key={id} className="block text-primary underline" href={`/api/files/${encodeURIComponent(id)}/content`}>{t('sr.sharedFile', { number: index + 1 })}</a>)}
    </article>)}
  </section>
}
