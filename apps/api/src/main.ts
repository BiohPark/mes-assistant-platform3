import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module.js'
import { configureApp } from './app.factory.js'
import { CONFIG, type AppConfig } from './config/config.js'
import { RequestsService } from './requests/requests.service.js'

const app = await NestFactory.create(AppModule)
const config = app.get<AppConfig>(CONFIG)
configureApp(app, config)
await app.get(RequestsService).startSweeper()
await app.listen(config.port)
console.log(`api listening on http://localhost:${config.port}/api`)
