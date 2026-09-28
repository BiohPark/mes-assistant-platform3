import type { INestApplication } from '@nestjs/common'
import cookieParser from 'cookie-parser'
import type { Request, Response, NextFunction } from 'express'
import { SESSION_COOKIE, SESSION_STORE, type SessionStore } from './auth/session.service.js'
import type { AppConfig } from './config/config.js'

/** main.ts와 테스트가 같은 설정으로 앱을 꾸민다 */
export function configureApp<T extends INestApplication>(app: T, config: AppConfig): T {
  app.setGlobalPrefix('api')
  app.use(cookieParser(config.sessionSecret))
  const sessions = app.get<SessionStore>(SESSION_STORE)
  const jsonBody = (limit: number) => async (req: Request, res: Response, next: NextFunction) => {
    if (!req.is('application/json')) return next()
    if (Number(req.headers['content-length']) > limit) return res.status(413).end()
    try {
      const token: unknown = req.cookies?.[SESSION_COOKIE]
      if (typeof token !== 'string' || !await sessions.resolve(token)) {
        req.on('end', () => res.status(401).end())
        req.on('error', next)
        req.resume()
        return
      }
    } catch (error) { return next(error) }
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) { req.pause(); res.status(413).end(); return }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (size > limit) return
      try { req.body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; next() }
      catch { res.status(400).end() }
    })
    req.on('error', next)
  }
  app.use('/api/tasks/:id/outputs', jsonBody(config.fileMaxBytes + 1024 * 1024))
  app.use(/^\/api\/threads\/[^/]+\/requests\/?$/, jsonBody(2 * 1024 * 1024))
  app.enableShutdownHooks()
  return app
}
