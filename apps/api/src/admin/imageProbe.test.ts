import { describe, expect, it } from 'vitest'
import { crc32, probeImage } from './imageProbe.js'

/** 1×1 투명 PNG(실제 인코더 산출물) */
export const ONE_PX_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
function chunk(type: string, data: Buffer, crcDelta = 0) {
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE((crc32(body) + crcDelta) >>> 0)
  return Buffer.concat([length, body, crc])
}
function ihdr(width: number, height: number) {
  const data = Buffer.alloc(13); data.writeUInt32BE(width, 0); data.writeUInt32BE(height, 4); data[8] = 8; data[9] = 6
  return data
}
/** 구조만 올바른 PNG — IHDR·IDAT·IEND, CRC 정상 */
function png(width: number, height: number, extra: { between?: Buffer; trailing?: Buffer; idat?: boolean; ihdrCrcDelta?: number } = {}) {
  return Buffer.concat([PNG_SIGNATURE, chunk('IHDR', ihdr(width, height), extra.ihdrCrcDelta), extra.between ?? Buffer.alloc(0),
    ...(extra.idat === false ? [] : [chunk('IDAT', Buffer.from([0x78, 0x9c, 0x63, 0x00]))]), chunk('IEND', Buffer.alloc(0)), extra.trailing ?? Buffer.alloc(0)])
}
function jpeg(width: number, height: number, extra: { eoi?: boolean; sof?: boolean } = {}) {
  const sof = Buffer.alloc(13)
  sof.writeUInt16BE(0xffc0, 0); sof.writeUInt16BE(11, 2); sof[4] = 8; sof.writeUInt16BE(height, 5); sof.writeUInt16BE(width, 7); sof[9] = 1
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00])
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02]), extra.sof === false ? Buffer.alloc(0) : sof, sos, Buffer.from([0x12, 0x34, 0xff, 0x00]), extra.eoi === false ? Buffer.alloc(0) : Buffer.from([0xff, 0xd9])])
}
function riffChunk(tag: string, data: Buffer) {
  const size = Buffer.alloc(4); size.writeUInt32LE(data.length)
  return Buffer.concat([Buffer.from(tag, 'latin1'), size, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)])
}
function webp(chunks: Buffer[], sizeDelta = 0) {
  const body = Buffer.concat([Buffer.from('WEBP', 'latin1'), ...chunks])
  const size = Buffer.alloc(4); size.writeUInt32LE(body.length + sizeDelta)
  return Buffer.concat([Buffer.from('RIFF', 'latin1'), size, body])
}
function vp8l(width: number, height: number) {
  const data = Buffer.alloc(6); data[0] = 0x2f; data.writeUInt32LE((((width - 1) | ((height - 1) << 14)) >>> 0), 1)
  return riffChunk('VP8L', data)
}
function vp8x(width: number, height: number, flags = 0) {
  const data = Buffer.alloc(10); data[0] = flags; data.writeUIntLE(width - 1, 4, 3); data.writeUIntLE(height - 1, 7, 3)
  return riffChunk('VP8X', data)
}

describe('probeImage — 매직바이트·헤더 치수에 더해 파일 구조를 검사한다 (U4 리뷰 P2)', () => {
  it('실제 인코더가 만든 1×1 PNG를 png로 읽는다', () => {
    expect(probeImage(ONE_PX_PNG)).toEqual({ mime: 'image/png', width: 1, height: 1 })
  })
  it('PNG·JPEG·WebP(VP8L·VP8X)의 너비·높이를 헤더에서 읽는다', () => {
    expect(probeImage(png(512, 300))).toEqual({ mime: 'image/png', width: 512, height: 300 })
    expect(probeImage(png(513, 1))).toEqual({ mime: 'image/png', width: 513, height: 1 })
    expect(probeImage(png(2, 2, { between: chunk('tEXt', Buffer.from('Comment\0ok')) }))).toEqual({ mime: 'image/png', width: 2, height: 2 })
    expect(probeImage(jpeg(640, 480))).toEqual({ mime: 'image/jpeg', width: 640, height: 480 })
    expect(probeImage(webp([vp8l(256, 128)]))).toEqual({ mime: 'image/webp', width: 256, height: 128 })
    expect(probeImage(webp([vp8x(1024, 768), vp8l(1024, 768)]))).toEqual({ mime: 'image/webp', width: 1024, height: 768 })
  })
  it.each([
    ['확장자만 png인 텍스트', Buffer.from('PNG가 아닙니다 .png')],
    ['빈 파일', Buffer.alloc(0)],
    ['GIF', Buffer.from('GIF89a\u0001\u0000\u0001\u0000', 'latin1')],
    ['SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')],
    ['PNG 서명 뒤 IHDR 없음', Buffer.concat([ONE_PX_PNG.subarray(0, 12), Buffer.from('IEND')])],
    ['픽셀 데이터 없는 24바이트 PNG 헤더', ONE_PX_PNG.subarray(0, 24)],
    ['IHDR까지만 있는 PNG(IDAT·IEND 없음)', ONE_PX_PNG.subarray(0, 33)],
    ['IDAT 없는 PNG', png(1, 1, { idat: false })],
    ['IHDR CRC 불일치', png(1, 1, { ihdrCrcDelta: 1 })],
    ['IHDR 치수만 바꾼 PNG(CRC 불일치)', (() => { const bytes = Buffer.from(ONE_PX_PNG); bytes.writeUInt32BE(513, 16); return bytes })()],
    ['IEND 뒤 꼬리 바이트', png(1, 1, { trailing: Buffer.from('tail') })],
    ['APNG(acTL)', png(1, 1, { between: chunk('acTL', Buffer.alloc(8)) })],
    ['너비 0 PNG', png(0, 1)],
    ['IHDR가 두 번', png(1, 1, { between: chunk('IHDR', ihdr(1, 1)) })],
    ['SOF 없는 JPEG', Buffer.from([0xff, 0xd8, 0xff, 0xd9])],
    ['EOI 없는 JPEG', jpeg(8, 8, { eoi: false })],
    ['SOS 앞에 SOF 없는 JPEG', jpeg(8, 8, { sof: false })],
    ['세그먼트 길이가 파일을 넘는 JPEG', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff, 0xff, 0xd9])],
    ['RIFF 길이 불일치 WebP', webp([vp8l(1, 1)], 4)],
    ['애니메이션 플래그 VP8X', webp([vp8x(1, 1, 0x02), vp8l(1, 1)])],
    ['ANIM 청크 WebP', webp([vp8x(1, 1), riffChunk('ANIM', Buffer.alloc(6)), vp8l(1, 1)])],
    ['비트스트림 없는 VP8X', webp([vp8x(1, 1)])],
    ['알 수 없는 첫 청크 WebP', webp([riffChunk('XXXX', Buffer.alloc(16))])],
    ['꼬리 바이트 WebP', Buffer.concat([webp([vp8l(1, 1)]), Buffer.from('x')])],
  ])('%s은 거부한다(null)', (_name, bytes) => {
    expect(probeImage(bytes)).toBeNull()
  })
})
