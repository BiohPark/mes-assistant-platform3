import type { ActivityLog } from '@mes/domain'

/** 활동 한 줄 요약. payload 키는 리포지토리에서 기록한 것을 그대로 쓴다. */
export function describeActivity(a: ActivityLog): string {
  const p = a.payload
  switch (a.type) {
    case 'checklist.checked':
    case 'checklist.unchecked':
      return String(p.label ?? '')
    case 'checklist.reviewed':
      return `${String(p.met ?? 0)}/${String(p.total ?? 0)} 달성${p.source === 'rule' ? ' (규칙 판단)' : ''}`
    case 'file.uploaded':
    case 'file.tagged_output':
      return String(p.name ?? '')
    case 'message.sent':
    case 'note.added':
      return String(p.preview ?? '')
    case 'model.changed':
      return `${String(p.scope ?? '')} → ${String(p.modelId ?? '')}`
    case 'input.selected':
      return `${String(p.name ?? '')} v${String(p.version ?? 1)} · ${p.weight === 'main' ? '주 입력' : '참고'}`
    case 'input.removed':
      return `${String(p.name ?? '')} v${String(p.version ?? 1)}`
    case 'context.selected':
    case 'context.refreshed': {
      const scope = p.mode === 'summary' ? '요약' : p.mode === 'messages' ? `고른 메시지 ${String(p.messages ?? 0)}개` : `전체 ${String(p.messages ?? 0)}개`
      return [String(p.code ?? ''), p.messages !== undefined ? scope : '', p.weight === 'main' ? '주 입력' : p.weight ? '참고' : ''].filter(Boolean).join(' · ')
    }
    case 'context.removed':
      return String(p.code ?? '')
    case 'thread.created':
      return String(p.title ?? '')
    case 'feedback.given':
      return '★'.repeat(Number(p.rating ?? 0))
    case 'task.created':
      return String(p.assistantName ?? '')
    case 'task.reopened':
      return p.reason ? `사유: ${String(p.reason)}` : ''
    case 'task.completed':
      return [Number(p.missingRequired ?? 0) > 0 ? `중요 체크 ${String(p.missingRequired)}건 미체크` : '', p.reason ? `사유: ${String(p.reason)}` : '']
        .filter(Boolean)
        .join(' · ')
    case 'tag.added':
    case 'tag.removed':
      return String(p.tag ?? '')
    case 'sr.task_started':
      return [p.code, p.taskCode].filter(Boolean).map(String).join(' → ')
    case 'sr.status_changed':
    case 'task.status_changed':
      return `${String(p.from ?? '')} → ${String(p.to ?? '')}`
    default:
      return ''
  }
}
