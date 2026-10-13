/**
 * 업로드 이미지 판별 — 확장자·클라이언트 MIME을 믿지 않고 바이트 구조를 검사한다(라이브러리·네이티브 의존 없음). PNG·JPEG·WebP 외는 null (U4)
 * - PNG: 서명, 청크 CRC, IHDR → (IDAT ≥1) → IEND 순서, 파일 끝 일치, APNG(acTL·fcTL·fdAT) 거부
 * - JPEG: SOI, SOS 앞의 SOF(한 번), 세그먼트 길이 정합, 파일 끝 EOI
 * - WebP: RIFF 길이 = 파일 길이, 첫 청크 VP8/VP8L/VP8X, 애니메이션(VP8X 플래그·ANIM·ANMF) 거부, VP8X는 비트스트림 필수
 * 픽셀 데이터를 디코딩하지는 않는다 — 치수·프레임 수·구조만 믿을 수 있는 수준
 */
export type ImageInfo = { mime: 'image/png' | 'image/jpeg' | 'image/webp'; width: number; height: number }

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const ascii = (bytes: Uint8Array, start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length))
const be16 = (bytes: Uint8Array, at: number) => (bytes[at]! << 8) | bytes[at + 1]!
const be32 = (bytes: Uint8Array, at: number) => ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0
const le24 = (bytes: Uint8Array, at: number) => bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16)
const le32 = (bytes: Uint8Array, at: number) => (bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16) | (bytes[at + 3]! << 24)) >>> 0
const validSize = (width: number, height: number) => width > 0 && height > 0

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
/** PNG 청크 CRC-32 (ISO 3309) */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function png(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length < 8 || PNG_SIGNATURE.some((value, index) => bytes[index] !== value)) return null
  let offset = 8
  let info: ImageInfo | null = null
  let idat = false
  while (offset + 12 <= bytes.length) {
    const length = be32(bytes, offset)
    const type = ascii(bytes, offset + 4, 4)
    const dataEnd = offset + 8 + length
    if (dataEnd + 4 > bytes.length || crc32(bytes.subarray(offset + 4, dataEnd)) !== be32(bytes, dataEnd)) return null
    if (!info) {
      if (type !== 'IHDR' || length !== 13) return null
      info = { mime: 'image/png', width: be32(bytes, offset + 8), height: be32(bytes, offset + 12) }
      if (!validSize(info.width, info.height)) return null
    } else if (type === 'IHDR' || type === 'acTL' || type === 'fcTL' || type === 'fdAT') return null
    else if (type === 'IDAT') idat = true
    else if (type === 'IEND') return length === 0 && idat && dataEnd + 4 === bytes.length ? info : null
    offset = dataEnd + 4
  }
  return null
}
function jpeg(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null
  if (bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return null // EOI
  let offset = 2
  let info: ImageInfo | null = null
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null
    const marker = bytes[offset + 1]!
    if (marker === 0xff) { offset++; continue } // 패딩
    if (marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue } // 길이 없는 마커
    if (marker === 0xd9) return null // SOS 전의 EOI
    const length = be16(bytes, offset + 2)
    if (length < 2 || offset + 2 + length > bytes.length) return null
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isSof) {
      if (info || length < 8) return null
      info = { mime: 'image/jpeg', width: be16(bytes, offset + 7), height: be16(bytes, offset + 5) }
      if (!validSize(info.width, info.height)) return null
    }
    if (marker === 0xda) return info // SOS — 이후는 엔트로피 데이터, 끝의 EOI는 위에서 확인
    offset += 2 + length
  }
  return null
}
function webp(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length < 12 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP' || le32(bytes, 4) + 8 !== bytes.length) return null
  let offset = 12
  let info: ImageInfo | null = null
  let extended = false
  let bitstream = false
  while (offset + 8 <= bytes.length) {
    const tag = ascii(bytes, offset, 4)
    const size = le32(bytes, offset + 4)
    const data = offset + 8
    if (data + size > bytes.length || tag === 'ANIM' || tag === 'ANMF') return null
    if (tag === 'VP8 ') {
      if (size < 10 || bytes[data + 3] !== 0x9d || bytes[data + 4] !== 0x01 || bytes[data + 5] !== 0x2a) return null
      info ??= { mime: 'image/webp', width: (bytes[data + 6]! | (bytes[data + 7]! << 8)) & 0x3fff, height: (bytes[data + 8]! | (bytes[data + 9]! << 8)) & 0x3fff }
      bitstream = true
    } else if (tag === 'VP8L') {
      if (size < 5 || bytes[data] !== 0x2f) return null
      const bits = le32(bytes, data + 1)
      info ??= { mime: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
      bitstream = true
    } else if (tag === 'VP8X') {
      if (info || size < 10 || (bytes[data]! & 0x02)) return null // 두 번째 VP8X·애니메이션 플래그
      info = { mime: 'image/webp', width: le24(bytes, data + 4) + 1, height: le24(bytes, data + 7) + 1 }
      extended = true
    } else if (!info) return null // 첫 청크는 비트스트림이나 VP8X
    offset = data + size + (size & 1)
  }
  if (!info || offset !== bytes.length || (extended && !bitstream) || !validSize(info.width, info.height)) return null
  return info
}

export function probeImage(bytes: Uint8Array): ImageInfo | null {
  return png(bytes) ?? jpeg(bytes) ?? webp(bytes)
}
