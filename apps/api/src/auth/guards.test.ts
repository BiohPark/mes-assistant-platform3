import 'reflect-metadata'
import type { ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { describe, expect, it } from 'vitest'
import { SessionGuard, type AuthedRequest } from './guards.js'
import { SESSION_COOKIE, type AuthUser, type SessionStore } from './session.service.js'

const requester: AuthUser = { id: 'bo', name: 'BO', role: '', theme: 'system', locale: 'ko', isBusinessOwner: true, isSystemOwner: false }

async function authorize(method: string, path: string, user: AuthUser | null = requester) {
  const req = { method, path, cookies: { [SESSION_COOKIE]: 'session' } } as unknown as AuthedRequest
  const guard = new SessionGuard(new Reflector(), { resolve: async () => user } as unknown as SessionStore)
  const context = { getHandler: () => authorize, getClass: () => SessionGuard,
    switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext
  const allowed = await guard.canActivate(context)
  return { allowed, user: req.user }
}

describe('BO events session guard', () => {
  it('allows GET /api/events and attaches the authenticated requester', async () => {
    await expect(authorize('GET', '/api/events')).resolves.toEqual({ allowed: true, user: requester })
  })

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('rejects %s /api/events', async method => {
    await expect(authorize(method, '/api/events')).rejects.toMatchObject({ status: 403 })
  })

  it.each(['/api/tasks', '/api/events/private', '/api/notifications', '/api/threads/thread/typing'])('does not widen GET %s', async path => {
    await expect(authorize('GET', path)).rejects.toMatchObject({ status: 403 })
  })

  it('requires a valid session', async () => {
    await expect(authorize('GET', '/api/events', null)).rejects.toMatchObject({ status: 401 })
  })

  it('keeps password change requirements in force', async () => {
    await expect(authorize('GET', '/api/events', { ...requester, mustChangePassword: true }))
      .rejects.toMatchObject({ status: 403, response: { code: 'PASSWORD_CHANGE_REQUIRED' } })
  })

  it.each([{ ...requester, isBusinessOwner: false }, { ...requester, isSystemOwner: true }])('preserves staff/system-owner access ($isSystemOwner)', async user => {
    await expect(authorize('GET', '/api/events', user)).resolves.toMatchObject({ allowed: true })
  })
})
