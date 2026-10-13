/** 업로드 이미지 판별 — 확장자·클라이언트 MIME을 믿지 않고 매직바이트와 헤더 치수만 읽는다(라이브러리 없음). PNG·JPEG·WebP 외는 null (U4) */
export type ImageInfo = { mime: 'image/png' | 'image/jpeg' | 'image/webp'; width: number; height: number }

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const ascii = (bytes: Uint8Array, start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length))
const be16 = (bytes: Uint8Array, at: number) => (bytes[at]! << 8) | bytes[at + 1]!
const be32 = (bytes: Uint8Array, at: number) => ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0
const le24 = (bytes: Uint8Array, at: number) => bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16)
const le32 = (bytes: Uint8Array, at: number) => (bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16) | (bytes[at + 3]! << 24)) >>> 0

function png(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length < 24 || PNG_SIGNATURE.some((value, index) => bytes[index] !== value) || ascii(bytes, 12, 4) !== 'IHDR') return null
  return { mime: 'image/png', width: be32(bytes, 16), height: be32(bytes, 20) }
}
function jpeg(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null
  let offset = 2
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null
    const marker = bytes[offset + 1]!
    if (marker === 0xff) { offset++; continue } // 패딩
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isSof) return { mime: 'image/jpeg', width: be16(bytes, offset + 7), height: be16(bytes, offset + 5) }
    if (marker === 0xd9 || marker === 0xda) return null // EOI·SOS 전에 SOF가 없다
    offset += 2 + be16(bytes, offset + 2)
  }
  return null
}
function webp(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length < 16 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') return null
  const chunk = ascii(bytes, 12, 4)
  if (chunk === 'VP8 ' && bytes.length >= 30) {
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null
    return { mime: 'image/webp', width: (bytes[26]! | (bytes[27]! << 8)) & 0x3fff, height: (bytes[28]! | (bytes[29]! << 8)) & 0x3fff }
  }
  if (chunk === 'VP8L' && bytes.length >= 25) {
    if (bytes[20] !== 0x2f) return null
    const bits = le32(bytes, 21)
    return { mime: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
  }
  if (chunk === 'VP8X' && bytes.length >= 30) return { mime: 'image/webp', width: le24(bytes, 24) + 1, height: le24(bytes, 27) + 1 }
  return null
}

export function probeImage(bytes: Uint8Array): ImageInfo | null {
  return png(bytes) ?? jpeg(bytes) ?? webp(bytes)
}
