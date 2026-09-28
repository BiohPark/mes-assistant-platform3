import { differenceInCalendarDays, format, formatDistanceToNowStrict, isValid, parseISO } from 'date-fns'
import { ko } from 'date-fns/locale'

function toDate(iso?: string): Date | undefined {
  if (!iso) return undefined
  const d = parseISO(iso)
  return isValid(d) ? d : undefined
}

export function formatDate(iso?: string, pattern = 'yyyy-MM-dd'): string {
  const d = toDate(iso)
  return d ? format(d, pattern) : '-'
}

export function formatDateTime(iso?: string): string {
  return formatDate(iso, 'MM-dd HH:mm')
}

export function formatRelative(iso?: string): string {
  const d = toDate(iso)
  return d ? formatDistanceToNowStrict(d, { addSuffix: true, locale: ko }) : '-'
}

/** 기한까지 남은 일수. 음수면 지연 */
export function daysUntil(iso?: string, now = new Date()): number | undefined {
  const d = toDate(iso)
  return d ? differenceInCalendarDays(d, now) : undefined
}

export function durationDays(startIso?: string, endIso?: string, now = new Date()): number | undefined {
  const s = toDate(startIso)
  if (!s) return undefined
  const e = toDate(endIso) ?? now
  return Math.max(0, Math.round(((e.getTime() - s.getTime()) / 86_400_000) * 10) / 10)
}
