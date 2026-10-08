import { useLayoutEffect, useRef, useState, type ChangeEvent, type CompositionEvent } from 'react'

import { useLocation, useNavigationType } from 'react-router'

const identity = (value: string) => value

/** Keep the input synchronous; router acknowledgements must not replace a newer edit or IME draft. */
export function useSearchText(urlValue: string, onSearch: (value: string) => void, normalize = identity) {
  const { key: navigationKey } = useLocation()
  const navigationType = useNavigationType()
  const [value, setValue] = useState(urlValue)
  const composing = useRef(false)
  const pending = useRef<string[]>([])
  const published = useRef(urlValue)
  const observed = useRef(urlValue)
  const observedNavigationKey = useRef(navigationKey)
  useLayoutEffect(() => {
    const previousUrlValue = observed.current
    const historyNavigation = navigationType === 'POP' && navigationKey !== observedNavigationKey.current
    observed.current = urlValue
    observedNavigationKey.current = navigationKey
    if (!historyNavigation) {
      const acknowledged = pending.current.lastIndexOf(urlValue)
      if (acknowledged !== -1) {
        pending.current.splice(0, acknowledged + 1)
        return
      }
      // A late URL normalization or unrelated action can commit the old query
      // after an edit. It does not acknowledge or cancel that pending edit.
      if (pending.current.length && urlValue === previousUrlValue) return
    }
    // A reset or history navigation may keep q unchanged (e.g. a whitespace-only draft).
    pending.current = []
    published.current = urlValue
    if (!composing.current) setValue(urlValue)
  }, [urlValue, navigationKey, navigationType])
  const publish = (text: string) => {
    const normalized = normalize(text)
    if (normalized === published.current) return
    published.current = normalized
    pending.current.push(normalized)
    onSearch(text)
  }
  return {
    value,
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      const text = event.currentTarget.value
      setValue(text)
      if (!composing.current) publish(text)
    },
    onCompositionStart: () => { composing.current = true },
    onCompositionEnd: (event: CompositionEvent<HTMLInputElement>) => {
      composing.current = false
      const text = event.currentTarget.value
      setValue(text)
      publish(text)
    },
  }
}
