import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
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
    { provide: OIDC, useClass: OpenIdOidc },
    // 순서대로 실행: 세션 확인 → 역할 확인
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AuthModule {}
