import { Inject, Injectable } from '@nestjs/common'
import * as client from 'openid-client'
import { CONFIG, type AppConfig } from '../config/config.js'
import type { SsoClaims } from './users.service.js'

/** 로그인 시작 때 만들어 콜백에서 대조하는 값 (서명된 httpOnly 쿠키로 왕복) */
export interface PendingLogin {
  state: string
  nonce: string
  codeVerifier: string
}

export interface OidcPort {
  start(): Promise<{ url: string; pending: PendingLogin }>
  finish(callbackUrl: URL, pending: PendingLogin): Promise<SsoClaims>
}

export const OIDC = Symbol('OIDC')

/** OIDC 수신 측(RP). 사내 IdP·Keycloak 모두 설정만 바꿔 쓴다. SAML은 필요해지면 같은 포트로 추가. */
@Injectable()
export class OpenIdOidc implements OidcPort {
  private discovered?: Promise<client.Configuration>

  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  private configuration() {
    const { issuer, clientId, clientSecret } = this.config.oidc
    this.discovered ??= client
      .discovery(new URL(issuer), clientId, clientSecret, undefined, {
        // 개발 Keycloak은 http — 운영 IdP는 https라 이 옵션이 붙지 않는다
        execute: issuer.startsWith('http://') ? [client.allowInsecureRequests] : [],
      })
      .catch((e: unknown) => {
        this.discovered = undefined // 다음 로그인 때 다시 시도
        throw e
      })
    return this.discovered
  }

  async start() {
    const configuration = await this.configuration()
    const pending: PendingLogin = {
      state: client.randomState(),
      nonce: client.randomNonce(),
      codeVerifier: client.randomPKCECodeVerifier(),
    }
    const url = client.buildAuthorizationUrl(configuration, {
      redirect_uri: this.config.oidc.redirectUri,
      scope: 'openid profile email',
      code_challenge: await client.calculatePKCECodeChallenge(pending.codeVerifier),
      code_challenge_method: 'S256',
      state: pending.state,
      nonce: pending.nonce,
    })
    return { url: url.href, pending }
  }

  async finish(callbackUrl: URL, pending: PendingLogin): Promise<SsoClaims> {
    const tokens = await client.authorizationCodeGrant(await this.configuration(), callbackUrl, {
      pkceCodeVerifier: pending.codeVerifier,
      expectedState: pending.state,
      expectedNonce: pending.nonce,
      idTokenExpected: true,
    })
    const claims = tokens.claims()
    if (!claims) throw new Error('ID 토큰이 없습니다')
    return {
      sub: claims.sub,
      preferred_username: typeof claims.preferred_username === 'string' ? claims.preferred_username : undefined,
      name: typeof claims.name === 'string' ? claims.name : undefined,
    }
  }
}
