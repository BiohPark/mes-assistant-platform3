import { format, isValid, parseISO } from 'date-fns'

function toDate(iso?: string): Date | undefined {
  if (!iso) return undefined
  const d = parseISO(iso)
  return isValid(d) ? d : undefined
}

export function formatDate(iso?: string, pattern = 'yyyy-MM-dd'): string {
  const d = toDate(iso)
  return d ? format(d, pattern) : '-'
}

export function durationDays(startIso?: string, endIso?: string, now = new Date()): number | undefined {
  const s = toDate(startIso)
  if (!s) return undefined
  const e = toDate(endIso) ?? now
  return Math.max(0, Math.round(((e.getTime() - s.getTime()) / 86_400_000) * 10) / 10)
}
