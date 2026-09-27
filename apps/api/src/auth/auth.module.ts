import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { CONFIG, type AppConfig } from '../config/config.js'
import { AuthController } from './auth.controller.js'
import { RolesGuard, SessionGuard } from './guards.js'
import { OIDC, OpenIdOidc } from './oidc.service.js'
import { DbSessionStore, SESSION_STORE } from './session.service.js'
import { DbUserDirectory, USER_DIRECTORY } from './users.service.js'

@Module({
  controllers: [AuthController],
  providers: [
    { provide: SESSION_STORE, useClass: DbSessionStore },
    { provide: USER_DIRECTORY, useClass: DbUserDirectory },
    { provide: OIDC, inject: [CONFIG], useFactory: (config: AppConfig) => config.authMode === 'oidc' ? new OpenIdOidc(config) : { start: () => { throw new Error('SSO 로그인이 비활성입니다') }, finish: () => { throw new Error('SSO 로그인이 비활성입니다') } } },
    // 순서대로 실행: 세션 확인 → 역할 확인
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AuthModule {}
