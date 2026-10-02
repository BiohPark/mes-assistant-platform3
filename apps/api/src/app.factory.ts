import type { INestApplication } from '@nestjs/common'
import { existsSync, realpathSync } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
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
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'same-origin')
    res.setHeader('X-Frame-Options', 'DENY')
    next()
  })
  app.use(cookieParser(config.sessionSecret))
  if (existsSync(config.webDistDir)) {
    const webRoot = realpathSync.native(config.webDistDir)
    app.use((req: Request, res: Response, next: NextFunction) => {
      const rawPath = req.originalUrl.split('?')[0]
      if (/^\/api(?:\/|$)/i.test(rawPath) || req.method !== 'GET') return next()
      let pathname: string
      try { pathname = decodeURIComponent(rawPath) }
      catch { return res.status(400).end() }
      if (/^\/api(?:\/|$)/i.test(pathname)) return next()
      if (pathname.includes('\\') || pathname.includes('\0') || pathname.includes('%') || pathname.split('/').some((part) => part === '..' || part === '.')) {
        return res.status(400).end()
      }
      const target = resolve(config.webDistDir, `.${pathname}`)
      const inside = relative(config.webDistDir, target)
      if (inside.startsWith(`..${sep}`) || inside === '..' || resolve(target) === resolve(config.webDistDir) && pathname !== '/') return res.status(400).end()
      const send = async (file: string, immutable: boolean) => {
        const actual = await realpath(file)
        const pathInRoot = relative(webRoot, actual)
        if (pathInRoot === '..' || pathInRoot.startsWith(`..${sep}`) || isAbsolute(pathInRoot)) return res.status(403).end()
        if (file.endsWith('index.html')) res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'")
        res.sendFile(actual, { headers: { 'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' } }, (error) => { if (error) next(error) })
      }
      void stat(target).then((info) => {
        const file = info.isFile() ? target : resolve(config.webDistDir, 'index.html')
        return send(file, info.isFile() && /^\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[^/]+$/.test(pathname))
      }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') return next(error)
        void send(resolve(config.webDistDir, 'index.html'), false).catch(next)
      })
    })
  }
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
