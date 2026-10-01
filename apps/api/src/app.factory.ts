import type { INestApplication } from '@nestjs/common'
import cookieParser from 'cookie-parser'
import type { Request, Response, NextFunction } from 'express'
import { eq } from 'drizzle-orm'
import { SESSION_COOKIE, SESSION_STORE, type SessionStore } from './auth/session.service.js'
import type { AppConfig } from './config/config.js'
import { DB, type Db } from './db/db.module.js'
import { appSetting } from './db/schema.js'

/** main.ts와 테스트가 같은 설정으로 앱을 꾸민다 */
export function configureApp<T extends INestApplication>(app: T, config: AppConfig): T {
  app.setGlobalPrefix('api')
  app.use(cookieParser(config.sessionSecret))
  const sessions = app.get<SessionStore>(SESSION_STORE)
  const jsonBody = (configuredLimit: number | (() => Promise<number>)) => async (req: Request, res: Response, next: NextFunction) => {
    if (!req.is('application/json')) return next()
    let limit: number
    try {
      const token: unknown = req.cookies?.[SESSION_COOKIE]
      if (typeof token !== 'string' || !await sessions.resolve(token)) {
        req.on('end', () => res.status(401).end())
        req.on('error', next)
        req.resume()
        return
      }
      limit = typeof configuredLimit === 'number' ? configuredLimit : await configuredLimit()
    } catch (error) { return next(error) }
    if (Number(req.headers['content-length']) > limit) return res.status(413).end()
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
  app.use(/^\/api\/threads\/[^/]+\/requests\/estimate\/?$/, jsonBody(2 * 1024 * 1024))
  app.use('/api/system-assistant/messages', jsonBody(async () => {
    const [setting] = await app.get<Db>(DB).select({ value: appSetting.value }).from(appSetting).where(eq(appSetting.key, 'requestBudgetBytes'))
    return typeof setting?.value === 'number' ? setting.value : config.request.budgetBytes
  }))
  app.enableShutdownHooks()
  return app
}
