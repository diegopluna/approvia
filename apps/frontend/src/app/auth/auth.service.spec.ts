import { beforeEach, describe, expect, it, vi } from 'vitest'

type KeycloakMock = {
  authenticated: boolean
  token?: string
  clearToken: ReturnType<typeof vi.fn>
  init: ReturnType<typeof vi.fn>
  login: ReturnType<typeof vi.fn>
  logout: ReturnType<typeof vi.fn>
  updateToken: ReturnType<typeof vi.fn>
  onAuthLogout?: () => void
  onAuthRefreshError?: () => void
  onAuthRefreshSuccess?: () => void
  onAuthSuccess?: () => void
  onTokenExpired?: () => void
}

const keycloakMocks = vi.hoisted(() => ({
  configs: [] as unknown[],
  instances: [] as KeycloakMock[],
}))

vi.mock('keycloak-js', () => ({
  default: class {
    authenticated = true
    token = 'access-token'
    clearToken = vi.fn(() => {
      this.authenticated = false
      this.token = ''
    })
    init = vi.fn().mockResolvedValue(true)
    login = vi.fn().mockResolvedValue(undefined)
    logout = vi.fn().mockResolvedValue(undefined)
    updateToken = vi.fn().mockResolvedValue(false)
    onAuthLogout?: () => void
    onAuthRefreshError?: () => void
    onAuthRefreshSuccess?: () => void
    onAuthSuccess?: () => void
    onTokenExpired?: () => void

    constructor(config: unknown) {
      keycloakMocks.configs.push(config)
      keycloakMocks.instances.push(this)
    }
  },
}))

import { AuthService } from './auth.service'

describe('AuthService', () => {
  beforeEach(() => {
    keycloakMocks.configs.length = 0
    keycloakMocks.instances.length = 0
    vi.stubGlobal('location', {
      href: 'http://localhost:4200/dashboard',
      origin: 'http://localhost:4200',
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            url: 'https://identity.example.com',
            realm: 'approvia',
            clientId: 'frontend',
          }),
          { status: 200 },
        ),
      ),
    )
  })

  it('loads runtime configuration and initializes silent SSO', async () => {
    const service = new AuthService()

    await service.init()

    expect(fetch).toHaveBeenCalledWith('/auth-config.json', {
      cache: 'no-store',
    })
    expect(keycloakMocks.configs[0]).toEqual({
      url: 'https://identity.example.com',
      realm: 'approvia',
      clientId: 'frontend',
    })
    expect(keycloakMocks.instances[0].init).toHaveBeenCalledWith({
      onLoad: 'check-sso',
      silentCheckSsoRedirectUri: 'http://localhost:4200/silent-check-sso.html',
      pkceMethod: 'S256',
    })
    expect(service.isAuthenticated()).toBe(true)
  })

  it('clears authentication after a token refresh failure', async () => {
    const service = new AuthService()
    await service.init()
    const keycloak = keycloakMocks.instances[0]
    keycloak.updateToken.mockRejectedValue(new Error('session expired'))

    await expect(service.getToken()).resolves.toBeNull()

    expect(keycloak.clearToken).toHaveBeenCalledOnce()
    expect(service.isAuthenticated()).toBe(false)
  })

  it('tracks Keycloak login and logout events', async () => {
    const service = new AuthService()
    await service.init()
    const keycloak = keycloakMocks.instances[0]

    keycloak.onAuthLogout?.()
    expect(service.isAuthenticated()).toBe(false)

    keycloak.onAuthSuccess?.()
    expect(service.isAuthenticated()).toBe(true)

    keycloak.onAuthRefreshError?.()
    expect(service.isAuthenticated()).toBe(false)
  })

  it('rejects an invalid runtime configuration', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ realm: 'approvia' }), { status: 200 }),
    )

    await expect(new AuthService().init()).rejects.toThrow(
      'Authentication config is invalid',
    )
  })
})
