import { describe, expect, it } from 'vitest'
import { probeImage } from './imageProbe.js'

/** 1×1 투명 PNG */
export const ONE_PX_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

function png(width: number, height: number) {
  const bytes = Buffer.from(ONE_PX_PNG)
  bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20)
  return bytes
}
function jpeg(width: number, height: number) {
  // SOI · APP0(길이 2, 빈 내용) · SOF0(길이 11: 정밀도·높이·너비·성분 1) · 나머지는 생략
  const sof = Buffer.alloc(13)
  sof.writeUInt16BE(0xffc0, 0); sof.writeUInt16BE(11, 2); sof[4] = 8; sof.writeUInt16BE(height, 5); sof.writeUInt16BE(width, 7); sof[9] = 1
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02]), sof])
}
function webpLossless(width: number, height: number) {
  const bits = (width - 1) | ((height - 1) << 14)
  const header = Buffer.alloc(26)
  header.write('RIFF', 0); header.writeUInt32LE(18, 4); header.write('WEBP', 8); header.write('VP8L', 12); header.writeUInt32LE(6, 16); header[20] = 0x2f; header.writeUInt32LE(bits >>> 0, 21)
  return header
}
function webpExtended(width: number, height: number) {
  const header = Buffer.alloc(30)
  header.write('RIFF', 0); header.writeUInt32LE(22, 4); header.write('WEBP', 8); header.write('VP8X', 12); header.writeUInt32LE(10, 16)
  header.writeUIntLE(width - 1, 24, 3); header.writeUIntLE(height - 1, 27, 3)
  return header
}

describe('probeImage — 매직바이트와 헤더 치수만 읽는다 (U4)', () => {
  it('진짜 1×1 PNG를 png로 읽는다', () => {
    expect(probeImage(ONE_PX_PNG)).toEqual({ mime: 'image/png', width: 1, height: 1 })
  })
  it.each([
    ['확장자만 png인 텍스트', Buffer.from('PNG가 아닙니다 .png')],
    ['빈 파일', Buffer.alloc(0)],
    ['GIF', Buffer.from('GIF89a\u0001\u0000\u0001\u0000', 'latin1')],
    ['PNG 서명 뒤 IHDR 없음', Buffer.concat([ONE_PX_PNG.subarray(0, 12), Buffer.from('IEND')])],
    ['SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')],
    ['SOF 없는 JPEG', Buffer.from([0xff, 0xd8, 0xff, 0xd9])],
    ['알 수 없는 WebP 청크', Buffer.concat([Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBPXXXX', 'latin1'), Buffer.alloc(16)])],
  ])('%s은 거부한다(null)', (_name, bytes) => {
    expect(probeImage(bytes)).toBeNull()
  })
  it('PNG·JPEG·WebP(VP8L·VP8X)의 너비·높이를 헤더에서 읽는다', () => {
    expect(probeImage(png(512, 300))).toEqual({ mime: 'image/png', width: 512, height: 300 })
    expect(probeImage(png(513, 1))).toEqual({ mime: 'image/png', width: 513, height: 1 })
    expect(probeImage(jpeg(640, 480))).toEqual({ mime: 'image/jpeg', width: 640, height: 480 })
    expect(probeImage(webpLossless(256, 128))).toEqual({ mime: 'image/webp', width: 256, height: 128 })
    expect(probeImage(webpExtended(1024, 768))).toEqual({ mime: 'image/webp', width: 1024, height: 768 })
  })
})
