import { createContext, use, useEffect, useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTheme } from 'next-themes'
import type { Locale, Me, Theme } from '@mes/contracts'
import { toast } from 'sonner'
import { setMyProfile } from '@/api/admin'

export const themeOptions = [{ value: 'system', label: '시스템 설정' }, { value: 'light', label: '라이트' }, { value: 'dark', label: '다크' }] as const
export const localeOptions = [{ value: 'ko', label: '한국어' }, { value: 'en', label: 'English' }] as const

type Preferences = Pick<Me, 'theme' | 'locale'>
const ProfileContext = createContext<{
  theme: Theme
  locale: Locale
  setLocale: (locale: Locale) => void
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
  const mutation = useMutation({
    mutationFn: (input: Partial<Preferences>) => setMyProfile(input),
    onMutate: async (input) => {
      await client.cancelQueries({ queryKey: ['me'] })
      const previous = { theme, locale }
      if (input.theme !== undefined) setTheme(input.theme)
      if (input.locale !== undefined) setLocale(input.locale)
      return previous
    },
    onSuccess: (updated, input) => {
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
      toast.error(error instanceof Error ? error.message : '프로필을 저장하지 못했습니다')
    },
  })
  return <ProfileContext value={{ theme: theme as Theme, locale, setLocale, save: mutation.mutate, pending: mutation.isPending, saving: mutation.isPending ? mutation.variables : undefined }}>{children}</ProfileContext>
}

export function useProfile() {
  const profile = use(ProfileContext)
  if (!profile) throw new Error('useProfile은 ProfileProvider 안에서만 쓸 수 있습니다')
  return profile
}
