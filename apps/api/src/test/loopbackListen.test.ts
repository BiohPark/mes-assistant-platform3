import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, it } from 'vitest'

it('테스트 서버의 와일드카드 임시 포트 listen은 막고 루프백 명시 바인딩은 허용한다', async () => {
  const server = createServer()
  expect(() => server.listen(0)).toThrow(/127\.0\.0\.1/)
  expect(() => server.listen({ port: 0 })).toThrow(/127\.0\.0\.1/)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  expect((server.address() as AddressInfo).address).toBe('127.0.0.1')
  await new Promise((resolve) => server.close(resolve))
})
