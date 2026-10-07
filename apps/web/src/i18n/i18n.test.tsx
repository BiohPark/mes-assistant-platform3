import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ko } from './ko'
import { en } from './en'
import { createT, I18nProvider, useT } from '.'
import { formatNumber } from '@/lib/numbers'

// Checked by typecheck; invalid calls must never execute.
export function translationTypeChecks() {
  const t = createT('ko')
  // @ts-expect-error Unknown dot path.
  t('nav.unknown')
  // @ts-expect-error Object namespaces are not messages.
  t('status.task')
  // @ts-expect-error Named interpolation is required.
  t('common.greeting')
  // @ts-expect-error Plural messages require a numeric count.
  t('common.items', { count: '1' })
}

function keys(value: object, prefix = ''): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return typeof child === 'string' ? [path] : keys(child, path)
  }).sort()
}

describe('typed messages', () => {
  it('English has exactly the Korean keys', () => {
    expect(keys(en)).toEqual(keys(ko))
  })

  it('every English message preserves the Korean interpolation parameters', () => {
    function placeholders(value: object): string[][] {
      return Object.values(value).flatMap((child) => typeof child === 'string'
        ? [[...child.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()]
        : placeholders(child))
    }
    expect(placeholders(en)).toEqual(placeholders(ko))
  })

  it('substitutes a name as text without recursively replacing its content', () => {
    expect(createT('ko')('common.greeting', { name: 'Kim {count}' })).toBe('안녕하세요, Kim {count}')
    expect(createT('en')('common.greeting', { name: '<Kim>' })).toBe('Hello, <Kim>')
  })

  it.each([[0, '0 items'], [1, '1 item'], [2, '2 items'], [1.5, '1.5 items'], [1000, '1,000 items']])('pluralizes English count %s', (count, expected) => {
    expect(createT('en')('common.items', { count: count as number })).toBe(expected)
  })

  it('Korean uses its other plural form even for one', () => {
    expect(createT('ko')('common.items', { count: 1 })).toBe('1개')
    expect(createT('ko')('common.items', { count: 2 })).toBe('2개')
  })

  it('reacts to a provider locale change', () => {
    function Label() { const t = useT(); return <span>{t('nav.hub')}</span> }
    const { rerender } = render(<I18nProvider locale="ko"><Label /></I18nProvider>)
    expect(screen.getByText('에이전트 허브')).toBeInTheDocument()
    rerender(<I18nProvider locale="en"><Label /></I18nProvider>)
    expect(screen.getByText('Agent Hub')).toBeInTheDocument()
    expect(screen.queryByText('에이전트 허브')).not.toBeInTheDocument()
  })

  it('formats numbers with locale and Intl options', () => {
    expect(formatNumber(1234567.5, 'en')).toBe('1,234,567.5')
    expect(formatNumber(1234567.5, 'ko')).toBe('1,234,567.5')
    expect(formatNumber(1234, 'en', { style: 'currency', currency: 'USD' })).toBe('$1,234.00')
    expect(formatNumber(1234, 'ko', { style: 'currency', currency: 'KRW' })).toBe('₩1,234')
  })
})
