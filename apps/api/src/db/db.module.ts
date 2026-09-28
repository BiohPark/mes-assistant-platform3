import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { CONFIG, type AppConfig } from '../config/config.js'

export const DB_CLIENT = Symbol('DB_CLIENT')
export const DB = Symbol('DB')
export type Db = ReturnType<typeof drizzle>

@Global()
@Module({
  providers: [
    {
      provide: DB_CLIENT,
      inject: [CONFIG],
      // postgres.js는 첫 쿼리 때 연결한다 — DB가 없어도 앱은 뜨고 /api/health가 down을 알린다
      useFactory: (config: AppConfig) => postgres(config.databaseUrl, { onnotice: () => undefined }),
    },
    { provide: DB, inject: [DB_CLIENT], useFactory: (client: postgres.Sql) => drizzle(client) },
  ],
  exports: [DB_CLIENT, DB],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(DB_CLIENT) private readonly client: postgres.Sql) {}

  async onApplicationShutdown() {
    await this.client.end({ timeout: 5 })
  }
}
