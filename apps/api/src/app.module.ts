import { Module } from '@nestjs/common'
import { AuthModule } from './auth/auth.module.js'
import { ConfigModule } from './config/config.module.js'
import { DbModule } from './db/db.module.js'
import { HealthModule } from './health/health.controller.js'

@Module({ imports: [ConfigModule, DbModule, HealthModule, AuthModule] })
export class AppModule {}
