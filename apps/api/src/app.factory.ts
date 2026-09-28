import type { INestApplication } from '@nestjs/common'
import cookieParser from 'cookie-parser'
import type { AppConfig } from './config/config.js'

/** main.ts와 테스트가 같은 설정으로 앱을 꾸민다 */
export function configureApp<T extends INestApplication>(app: T, config: AppConfig): T {
  app.setGlobalPrefix('api')
  app.use(cookieParser(config.sessionSecret))
  app.enableShutdownHooks()
  return app
}
