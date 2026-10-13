import net from 'node:net'

// supertest는 리스닝 전인 서버를 listen(0)(IPv6 와일드카드 '::', dual-stack)으로 열고 127.0.0.1:포트로 요청한다.
// macOS는 와일드카드 임시 포트를 고를 때 다른 프로세스가 명시 포트로 연 127.0.0.1 리스너를 피하지 않고,
// 더 구체적인 127.0.0.1 바인딩이 요청을 가져간다 → 남의 서버가 401/403/400을 돌려주거나 응답 없이 멈춘다(간헐 실패).
// 테스트 서버는 `await app.listen(0, '127.0.0.1')`처럼 루프백에 명시 바인딩해야 한다 — 와일드카드 임시 포트는 여기서 막는다.
const listen = net.Server.prototype.listen
net.Server.prototype.listen = function (this: net.Server, ...args: unknown[]) {
  const [first, second] = args
  const options = typeof first === 'object' && first !== null ? first as net.ListenOptions : undefined
  const port = options ? options.port : first
  const host = options ? options.host : typeof second === 'string' ? second : undefined
  if ((port === 0 || port === '0') && !host && !options?.path) {
    throw new Error("테스트 서버는 와일드카드 임시 포트로 열지 않는다 — app.listen(0, '127.0.0.1')로 루프백에 바인딩하세요 (src/test/loopbackListen.ts)")
  }
  return Reflect.apply(listen, this, args) as net.Server
} as typeof net.Server.prototype.listen
