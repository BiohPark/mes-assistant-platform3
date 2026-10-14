import 'reflect-metadata'
import type { Response } from 'express'
import { expect, it, vi } from 'vitest'
import { loadConfig } from '../config/config.js'
import { AuthController } from './auth.controller.js'
import type { AuthedRequest } from './guards.js'
import type { OidcPort } from './oidc.service.js'
import type { AuthUser, SessionStore } from './session.service.js'
import type { UserDirectory } from './users.service.js'

it.each(['http', 'https'])('OIDC 콜백 주소·리다이렉트·쿠키는 추가 출처와 무관하게 %s APP_ORIGIN을 따른다', async (scheme) => {
  const origin = `${scheme}://hub.example.com`
  const config = loadConfig({ DATABASE_URL: 'mysql://unused', SESSION_SECRET: 's'.repeat(32),
    APP_ORIGIN: origin, APP_EXTRA_ORIGINS: 'http://alias.example.com,https://alias.example.com',
    AUTH_MODE: 'oidc', OIDC_ISSUER: 'https://idp.example.com', OIDC_CLIENT_ID: 'test', OIDC_CLIENT_SECRET: 'test-secret' })
  const pending = { state: 'state', nonce: 'nonce', codeVerifier: 'verifier' }
  const user: AuthUser = { id: 'member', name: 'Member', role: '', theme: 'system', locale: 'ko', isSystemOwner: false }
  const oidc: OidcPort = { start: vi.fn(async () => ({ url: 'https://idp.example.com/auth', pending })),
    finish: vi.fn(async () => ({ sub: 'member' })) }
  const users: UserDirectory = { upsertFromClaims: vi.fn(async () => user),
    createLocal: vi.fn(async () => null), findByLoginId: vi.fn(async () => null) }
  const expiresAt = new Date(Date.now() + 3600_000)
  const sessions: SessionStore = { create: vi.fn(async () => ({ token: 'token', expiresAt })),
    resolve: vi.fn(async () => null), destroy: vi.fn(async () => undefined) }
  const response = { cookie: vi.fn(), clearCookie: vi.fn(), redirect: vi.fn() }
  const controller = new AuthController(config, oidc, sessions, users)
  await controller.login(response as unknown as Response)
  expect(response.cookie).toHaveBeenCalledWith('mes_oidc', JSON.stringify(pending), expect.objectContaining({ secure: scheme === 'https' }))
  await controller.callback({ originalUrl: '/api/auth/callback?code=code&state=state',
    signedCookies: { mes_oidc: JSON.stringify(pending) }, headers: { host: 'alias.example.com', origin: 'https://alias.example.com' },
  } as unknown as AuthedRequest, response as unknown as Response)
  expect(oidc.finish).toHaveBeenCalledWith(new URL(`${origin}/api/auth/callback?code=code&state=state`), pending)
  expect(response.redirect).toHaveBeenLastCalledWith(302, `${origin}/`)
  expect(response.cookie).toHaveBeenCalledWith('mes_session', 'token', expect.objectContaining({ secure: scheme === 'https', expires: expiresAt }))
})
