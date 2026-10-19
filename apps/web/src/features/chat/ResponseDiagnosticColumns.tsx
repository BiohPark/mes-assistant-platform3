import type { AnswerStep, RawResponse } from '@mes/domain'
import { useT } from '@/i18n'

/** The raw upstream payload, public parse, and displayed answer share one view. */
export function ResponseDiagnosticColumns({ result }: { result: { rawResponse: RawResponse | null; steps: AnswerStep[]; content: string } }) {
  const t = useT()
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <div className="min-w-0"><h3 className="font-medium">{t('chat.rawResponse')}</h3><pre data-testid="raw-response-json" tabIndex={0} className="max-h-[55vh] overflow-auto whitespace-pre-wrap break-all rounded-lg border p-2 text-xs">{result.rawResponse === null ? t('chat.noRawResponse') : JSON.stringify(result.rawResponse, null, 2)}</pre></div>
      <div className="min-w-0"><h3 className="font-medium">{t('chat.parsedSteps')}</h3><pre data-testid="parsed-steps" tabIndex={0} className="max-h-[55vh] overflow-auto whitespace-pre-wrap break-all rounded-lg border p-2 text-xs">{JSON.stringify(result.steps, null, 2)}</pre></div>
      <div className="min-w-0"><h3 className="font-medium">{t('chat.responseBody')}</h3><pre data-testid="response-body" tabIndex={0} className="max-h-[55vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border p-2 text-xs">{result.content}</pre></div>
    </div>
  )
}
