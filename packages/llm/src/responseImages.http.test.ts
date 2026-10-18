import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, it } from 'vitest'
import { collectResponseImages } from './responseImages.js'

it('refuses a real HTTP redirect before requesting its target', async () => {
  let targets = 0
  const server = createServer((req, res) => {
    if (req.url === '/redirect') {
      expect(req.headers.authorization).toBe('Bearer image-test-key')
      res.writeHead(302, { Location: '/target' }).end()
    } else { targets++; res.writeHead(200, { 'content-type': 'image/png' }).end('image') }
  })
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const { port } = server.address() as AddressInfo
    const result = await collectResponseImages({ mode: 'live', preset: 'openwebui', baseUrl: `http://127.0.0.1:${port}/api`, apiKey: 'image-test-key', model: 'model' }, '![i](/redirect)')
    expect(result.images).toEqual([])
    expect(result.failures).toEqual([{ source: '/redirect', reason: '리다이렉트 응답은 허용하지 않습니다' }])
    expect(targets).toBe(0)
  } finally {
    server.closeAllConnections()
    if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})
