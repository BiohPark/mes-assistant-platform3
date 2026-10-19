/** Diagnostic storage ceiling. Oversized JSON is replaced by its UTF-8 byte length, never sliced. */
export const RAW_RESPONSE_MAX_BYTES = 262_144
export type RawResponse = Record<string, unknown>
export function boundRawResponse(value: RawResponse): RawResponse {
  const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength
  return bytes <= RAW_RESPONSE_MAX_BYTES ? value : { bytes }
}
