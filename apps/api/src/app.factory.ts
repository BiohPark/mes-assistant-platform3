import type { INestApplication } from '@nestjs/common'
import cookieParser from 'cookie-parser'
import type { AppConfig } from './config/config.js'

/** main.ts와 테스트가 같은 설정으로 앱을 꾸민다 */
export function configureApp<T extends INestApplication>(app: T, config: AppConfig): T {
  app.setGlobalPrefix('api')
  app.use(cookieParser(config.sessionSecret))
  const bodyParserApp = app as unknown as { useBodyParser: (type: string, options: { limit: number }) => void }
  bodyParserApp.useBodyParser('json', { limit: config.fileMaxBytes + 1024 * 1024 })
  app.enableShutdownHooks()
  return app
}
