import { Inject, Injectable, type BeforeApplicationShutdown, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'

/** End SSE before server.close(): it otherwise waits forever for /events clients,
 * preventing onApplicationShutdown (including the DB pool cleanup) from running. */
@Injectable()
export class SseShutdown implements OnModuleInit, BeforeApplicationShutdown, OnApplicationShutdown {
  private server?: Server
  private draining = false
  private readonly responses = new Set<ServerResponse>()
  private readonly track = (_req: IncomingMessage, res: ServerResponse) => {
    if (res.writableEnded || res.destroyed) return
    this.responses.add(res)
    res.once('close', () => this.responses.delete(res))
    if (this.draining) this.drain(res)
  }

  constructor(@Inject(HttpAdapterHost) private readonly adapter: HttpAdapterHost) {}

  onModuleInit() {
    const server = this.adapter.httpAdapter.getHttpServer() as Server
    this.server = server
    server.on('request', this.track)
  }

  beforeApplicationShutdown() {
    this.draining = true
    for (const res of this.responses) this.drain(res)
  }

  private drain(res: ServerResponse) {
    const isSse = () => String(res.getHeader('content-type')).split(';')[0]?.trim() === 'text/event-stream'
    if (isSse()) { res.end(); return }
    // Authentication/start may still be awaiting the DB when shutdown begins.
    // Inspect their eventual headers too; let finite JSON/HTML responses finish normally.
    const writeHead = res.writeHead
    res.writeHead = ((...args: Parameters<ServerResponse['writeHead']>) => {
      const result = Reflect.apply(writeHead, res, args) as ServerResponse
      if (isSse()) queueMicrotask(() => { if (!res.writableEnded && !res.destroyed) res.end() })
      return result
    }) as ServerResponse['writeHead']
  }

  onApplicationShutdown() {
    this.server?.off('request', this.track)
    this.responses.clear()
  }
}
