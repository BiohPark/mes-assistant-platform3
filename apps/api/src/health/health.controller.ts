import { Controller, Get, Inject, Module, Res } from '@nestjs/common'
import type { Health } from '@mes/contracts'
import type { Response } from 'express'
import type { Pool } from 'mysql2/promise'
import { Public } from '../auth/public.decorator.js'
import { DB_CLIENT } from '../db/db.module.js'

export const HEALTH_PROBE = Symbol('HEALTH_PROBE')
export type HealthProbe = () => Promise<boolean>

@Controller('health')
export class HealthController {
  constructor(@Inject(HEALTH_PROBE) private readonly dbUp: HealthProbe) {}

  @Get()
  @Public()
  async check(@Res({ passthrough: true }) res: Response): Promise<Health> {
    const up = await this.dbUp()
    res.status(up ? 200 : 503)
    return up ? { status: 'ok', db: 'up' } : { status: 'degraded', db: 'down' }
  }
}

@Module({
  controllers: [HealthController],
  providers: [
    {
      provide: HEALTH_PROBE,
      inject: [DB_CLIENT],
      useFactory:
        (client: Pool): HealthProbe =>
        async () => {
          try {
            await client.query('select 1')
            return true
          } catch {
            return false
          }
        },
    },
  ],
})
export class HealthModule {}
