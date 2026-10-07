import { differenceInCalendarDays, format, formatDistanceToNowStrict, isValid, parseISO } from 'date-fns'
import { enUS, ko } from 'date-fns/locale'
import { useMemo } from 'react'
import type { Locale } from '@mes/contracts'
import { useLocale } from '@/i18n'

const locales = { ko, en: enUS }

function toDate(iso?: string): Date | undefined {
  if (!iso) return undefined
  const d = parseISO(iso)
  return isValid(d) ? d : undefined
}

export function formatDate(iso?: string, pattern = 'yyyy-MM-dd', locale: Locale = 'ko'): string {
  const d = toDate(iso)
  return d ? format(d, pattern, { locale: locales[locale] }) : '-'
}

export function formatDateTime(iso?: string, locale: Locale = 'ko'): string {
  return formatDate(iso, 'MM-dd HH:mm', locale)
}

export function formatRelative(iso?: string, locale: Locale = 'ko'): string {
  const d = toDate(iso)
  return d ? formatDistanceToNowStrict(d, { addSuffix: true, locale: locales[locale] }) : '-'
}

export function useDates() {
  const locale = useLocale()
  return useMemo(() => ({
    formatDate: (iso?: string, pattern = 'yyyy-MM-dd') => formatDate(iso, pattern, locale),
    formatDateTime: (iso?: string) => formatDateTime(iso, locale),
    formatRelative: (iso?: string) => formatRelative(iso, locale),
  }), [locale])
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
