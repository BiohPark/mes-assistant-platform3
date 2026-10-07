import { createContext, use, useEffect, useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTheme } from 'next-themes'
import type { Locale, Me, Theme } from '@mes/contracts'
import { toast } from 'sonner'
import { setMyProfile } from '@/api/admin'
import { createT, I18nProvider } from '@/i18n'
import { ko } from '@/i18n/ko'

export const themeOptions = [{ value: 'system', label: ko.common.themeSystem, key: 'common.themeSystem' }, { value: 'light', label: ko.common.themeLight, key: 'common.themeLight' }, { value: 'dark', label: ko.common.themeDark, key: 'common.themeDark' }] as const
export const localeOptions = [{ value: 'ko', label: ko.common.korean, key: 'common.korean' }, { value: 'en', label: ko.common.english, key: 'common.english' }] as const

type Preferences = Pick<Me, 'theme' | 'locale'>
const ProfileContext = createContext<{
  theme: Theme
  locale: Locale
  setLocale: (locale: Locale) => void
  reset: () => void
  save: (input: Partial<Preferences>) => void
  pending: boolean
  saving: Partial<Preferences> | undefined
} | null>(null)

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { theme = 'system', setTheme } = useTheme()
  const [locale, setLocale] = useState<Locale>(() => {
    try { return localStorage.getItem('mes-locale') === 'en' ? 'en' : 'ko' }
    catch { return 'ko' }
  })
  const client = useQueryClient()
  useEffect(() => {
    document.documentElement.lang = locale
    try { localStorage.setItem('mes-locale', locale) } catch { /* 캐시 저장이 막혀도 화면에는 적용한다 */ }
  }, [locale])
  function reset() {
    setTheme('system')
    setLocale('ko')
    try {
      localStorage.setItem('mes-theme', 'system')
      localStorage.setItem('mes-locale', 'ko')
    } catch { /* 캐시 저장이 막혀도 화면에는 적용한다 */ }
  }
  const mutation = useMutation({
    mutationFn: (input: Partial<Preferences>) => setMyProfile(input),
    onMutate: async (input) => {
      await client.cancelQueries({ queryKey: ['me'] })
      const previous = { theme, locale }
      if (input.theme !== undefined) setTheme(input.theme)
      if (input.locale !== undefined) setLocale(input.locale)
      return previous
    },
    onSuccess: async (updated, input) => {
      await client.cancelQueries({ queryKey: ['me'] })
      client.setQueryData<Me>(['me'], (current) => current ? { ...current,
        ...(input.theme !== undefined && { theme: updated.theme }),
        ...(input.locale !== undefined && { locale: updated.locale }),
      } : current)
    },
    onError: (error, input, previous) => {
      const current = client.getQueryData<Me>(['me'])
      if (previous) {
        if (input.theme !== undefined) setTheme(current?.theme ?? previous.theme)
        if (input.locale !== undefined) setLocale(current?.locale ?? previous.locale)
      }
      toast.error(error instanceof Error ? error.message : createT(locale)('common.profileSaveFailed'))
    },
    onSettled: () => client.invalidateQueries({ queryKey: ['me'] }),
  })
  return <ProfileContext value={{ theme: theme as Theme, locale, setLocale, reset, save: mutation.mutate, pending: mutation.isPending, saving: mutation.isPending ? mutation.variables : undefined }}><I18nProvider locale={locale}>{children}</I18nProvider></ProfileContext>
}

export function useProfile() {
  const profile = use(ProfileContext)
  if (!profile) throw new Error('useProfile은 ProfileProvider 안에서만 쓸 수 있습니다')
  return profile
}
