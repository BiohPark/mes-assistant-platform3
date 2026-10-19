import { expect, it } from 'vitest'
import { boundRawResponse, RAW_RESPONSE_MAX_BYTES } from './rawResponse.js'
it('retains JSON through exactly 256 KiB and stores only UTF-8 byte length above the bound', () => {
  expect(RAW_RESPONSE_MAX_BYTES).toBe(262_144)
  const exact = { text: 'x'.repeat(262_133) }
  expect(new TextEncoder().encode(JSON.stringify(exact)).byteLength).toBe(262_144)
  expect(boundRawResponse(exact)).toEqual(exact)
  const large = { text: '한'.repeat(100_000) }
  expect(boundRawResponse(large)).toEqual({ bytes: new TextEncoder().encode(JSON.stringify(large)).byteLength })
})
