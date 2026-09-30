import type { Response } from 'express'
import type { RequestEvent } from './requests.service.js'

export function writeEvent(res: Response, event: RequestEvent): void {
  if (res.writableEnded || res.destroyed) return
  res.write(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`)
}
