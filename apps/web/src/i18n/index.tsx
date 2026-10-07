import { createContext, use, useMemo, type ReactNode } from 'react'
import type { Locale } from '@mes/contracts'
import { en } from './en'
import { ko } from './ko'

type Paths<T> = { [K in keyof T & string]: T[K] extends string ? K : T[K] extends { one: string; other: string } ? K | `${K}.one` | `${K}.other` : `${K}.${Paths<T[K]>}` }[keyof T & string]
export type TranslationKey = Paths<typeof ko>
type Value<T, K extends string> = K extends `${infer Head}.${infer Tail}` ? Head extends keyof T ? Value<T[Head], Tail> : never : K extends keyof T ? T[K] : never
type Names<S> = S extends `${string}{${infer Name}}${infer Rest}` ? Name | Names<Rest> : never
type Params<K extends TranslationKey> = Value<typeof ko, K> extends { one: string; other: string }
  ? { count: number }
  : { [Name in Names<Value<typeof ko, K>>]: string | number }
export type Translator = <K extends TranslationKey>(key: K, ...args: keyof Params<K> extends never ? [params?: Record<string, string | number>] : [params: Params<K>]) => string

export function createT(locale: Locale): Translator {
  const messages = locale === 'en' ? en : ko
  const plurals = new Intl.PluralRules(locale)
  const numbers = new Intl.NumberFormat(locale)
  return ((key: TranslationKey, params: Record<string, string | number> = {}) => {
    let value: unknown = messages
    for (const part of key.split('.')) value = (value as Record<string, unknown>)[part]
    if (typeof value === 'object' && value !== null) {
      if (typeof params.count !== 'number') throw new Error(`Missing count for ${key}`)
      const forms = value as { one: string; other: string }
      value = plurals.select(params.count) === 'one' ? forms.one : forms.other
    }
    if (typeof value !== 'string') throw new Error(`Unknown translation key: ${key}`)
    return value.replace(/\{(\w+)\}/g, (_, name: string) => {
      const replacement = params[name]
      if (replacement === undefined) throw new Error(`Missing ${name} for ${key}`)
      return typeof replacement === 'number' ? numbers.format(replacement) : replacement
    })
  }) as Translator
}

const I18nContext = createContext({ locale: 'ko' as Locale, t: createT('ko') })

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo(() => ({ locale, t: createT(locale) }), [locale])
  return <I18nContext value={value}>{children}</I18nContext>
}

export function useT() { return use(I18nContext).t }
export function useLocale() { return use(I18nContext).locale }
