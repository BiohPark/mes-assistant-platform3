import 'reflect-metadata'
import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module.js'
import { configureApp } from './app.factory.js'
import { CONFIG, type AppConfig } from './config/config.js'
import { DB, type Db } from './db/db.module.js'
import { warnIgnoredDefaultModelSetting } from './llm/effectiveDefaultModel.js'
import { RequestsService } from './requests/requests.service.js'

const app = await NestFactory.create(AppModule)
const config = app.get<AppConfig>(CONFIG)
configureApp(app, config)
await warnIgnoredDefaultModelSetting(app.get<Db>(DB), config, (line) => new Logger('Bootstrap').warn(line))
await app.get(RequestsService).startSweeper()
await app.listen(config.port)
console.log(`api listening on http://localhost:${config.port}/api`)
