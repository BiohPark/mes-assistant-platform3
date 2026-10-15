import 'reflect-metadata'
import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module.js'
import { configureApp } from './app.factory.js'
import { CONFIG, loadConfig, type AppConfig } from './config/config.js'
import { httpsOriginWarning, loadHttpsOptions } from './https/https.js'
import { DB, type Db } from './db/db.module.js'
import { warnIgnoredDefaultModelSetting } from './llm/effectiveDefaultModel.js'
import { RequestsService } from './requests/requests.service.js'

const httpsOptions = loadHttpsOptions(loadConfig(process.env).https)
const app = await NestFactory.create(AppModule, httpsOptions ? { httpsOptions } : {})
const config = app.get<AppConfig>(CONFIG)
new Logger('Bootstrap').log(`파일 저장소: ${config.fileStorageRoot}`)
const originWarning = httpsOriginWarning(config)
if (originWarning) new Logger('Bootstrap').warn(originWarning)
configureApp(app, config)
await warnIgnoredDefaultModelSetting(app.get<Db>(DB), config, (line) => new Logger('Bootstrap').warn(line))
await app.get(RequestsService).startSweeper()
await app.listen(config.port)
console.log(`api listening on ${httpsOptions ? 'https' : 'http'}://localhost:${config.port}/api`)
