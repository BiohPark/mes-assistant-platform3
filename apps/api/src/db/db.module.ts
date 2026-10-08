import { Global, Inject, Module, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common'
import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2'
import type { Pool } from 'mysql2/promise'
import { CONFIG, type AppConfig } from '../config/config.js'
import { assertClassificationInvariants } from './classifications.js'
import { createPool } from './connection.js'

export const DB_CLIENT = Symbol('DB_CLIENT')
export const DB = Symbol('DB')
export type Db = MySql2Database

@Global()
@Module({
  providers: [
    {
      provide: DB_CLIENT,
      inject: [CONFIG],
      useFactory: (config: AppConfig) => createPool(config.databaseUrl),
    },
    { provide: DB, inject: [DB_CLIENT], useFactory: (client: Pool) => drizzle(client) },
  ],
  exports: [DB_CLIENT, DB],
})
export class DbModule implements OnApplicationShutdown, OnModuleInit {
  constructor(@Inject(DB_CLIENT) private readonly client: Pool, @Inject(DB) private readonly db: Db) {}

  async onModuleInit() { await assertClassificationInvariants(this.db) }

  async onApplicationShutdown() {
    await this.client.end()
  }
}
