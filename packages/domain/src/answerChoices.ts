export interface DetectedAnswerChoices {
  items: string[]
  /** A question before the list strengthens the signal, but is not required. */
  confidence: 'question' | 'list'
}

/** Only a short, flat list at the end of the answer is a choice candidate. */
export function detectAnswerChoices(text: string): DetectedAnswerChoices | null {
  const lines = text.replace(/\r\n?/g, '\n').trimEnd().split('\n')
  // Keep fenced examples out, including an unfinished fence at the end.
  let fence: { char: string; length: number } | undefined
  const inCode = lines.map(line => {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    const inside = !!fence
    if (marker) {
      if (!fence) fence = { char: marker[1]![0]!, length: marker[1]!.length }
      else if (marker[1]![0] === fence.char && marker[1]!.length >= fence.length && !marker[2]!.trim()) fence = undefined
    }
    return inside || !!marker
  })
  const itemPattern = /^( {0,3})(?:\d+[.)]|[①-⑳][.)]?|[A-Za-z가-힣][.)]|[-*])\s+(.+?)\s*$/
  const items: string[] = []
  let indent: string | undefined
  let index = lines.length - 1
  for (; index >= 0; index--) {
    const line = lines[index]!
    if (!line.trim()) continue
    if (inCode[index]) {
      if (!items.length) return null
      break
    }
    const item = itemPattern.exec(line)
    if (!item) break
    if (indent !== undefined && indent !== item[1]) return null
    indent = item[1]!
    const value = item[2]!
    if ([...value].length > 80 || value.includes('|')) return null
    items.unshift(value)
  }
  if (items.length < 2 || items.length > 6) return null
  // A continuation or nested list is not a flat choice list.
  if (index >= 0 && /^\s+\S/.test(lines[index]!)) return null
  // Markdown permits unindented continuation lines inside an item. Do not
  // mistake the remaining suffix of that same list for a new short list.
  for (let previous = index; previous >= 0 && lines[previous]!.trim(); previous--) {
    if (inCode[previous]) break
    if (itemPattern.test(lines[previous]!)) return null
  }
  const before = lines.slice(0, index + 1).join('\n').trimEnd()
  return { items, confidence: /[?？]\s*$/.test(before) ? 'question' : 'list' }
}
