import { useMemo } from 'react'
import type { Locale } from '@mes/contracts'
import { useLocale } from '@/i18n'

export function formatNumber(value: number, locale: Locale = 'ko', options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(locale, options).format(value)
}

export function useNumberFormat() {
  const locale = useLocale()
  return useMemo(() => (value: number, options?: Intl.NumberFormatOptions) => formatNumber(value, locale, options), [locale])
}
