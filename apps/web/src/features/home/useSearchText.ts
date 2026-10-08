import { useLayoutEffect, useRef, useState, type ChangeEvent, type CompositionEvent } from 'react'

import { useLocation } from 'react-router'

const identity = (value: string) => value

/** Keep the input synchronous; router acknowledgements must not replace a newer edit or IME draft. */
export function useSearchText(urlValue: string, onSearch: (value: string) => void, normalize = identity) {
  const { key: navigationKey } = useLocation()
  const [value, setValue] = useState(urlValue)
  const composing = useRef(false)
  const pending = useRef<string[]>([])
  const published = useRef(urlValue)
  useLayoutEffect(() => {
    const acknowledged = pending.current.lastIndexOf(urlValue)
    if (acknowledged !== -1) {
      pending.current.splice(0, acknowledged + 1)
      return
    }
    // A reset or history navigation may keep q unchanged (e.g. a whitespace-only draft).
    pending.current = []
    published.current = urlValue
    if (!composing.current) setValue(urlValue)
  }, [urlValue, navigationKey])
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
