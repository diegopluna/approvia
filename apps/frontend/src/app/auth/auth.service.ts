import { Injectable, signal } from '@angular/core'
import Keycloak, { type KeycloakConfig } from 'keycloak-js'

const MIN_TOKEN_VALIDITY_SECONDS = 30
const AUTH_CONFIG_URL = '/auth-config.json'

@Injectable({ providedIn: 'root' })
export class AuthService {
  private keycloak: Keycloak | null = null

  private readonly _authenticated = signal(false)
  readonly isAuthenticated = this._authenticated.asReadonly()

  async init(): Promise<void> {
    const keycloak = new Keycloak(await this.loadConfig())
    this.keycloak = keycloak
    keycloak.onAuthSuccess = () => this._authenticated.set(true)
    keycloak.onAuthRefreshSuccess = () => this._authenticated.set(true)
    keycloak.onAuthLogout = () => this._authenticated.set(false)
    keycloak.onAuthRefreshError = () => this._authenticated.set(false)
    keycloak.onTokenExpired = () => void this.getToken()

    const authenticated = await keycloak.init({
      onLoad: 'check-sso',
      silentCheckSsoRedirectUri: `${location.origin}/silent-check-sso.html`,
      pkceMethod: 'S256',
    })
    this._authenticated.set(authenticated)
  }

  login(redirectUri: string = location.href): Promise<void> {
    return this.getKeycloak().login({ redirectUri })
  }

  logout(): Promise<void> {
    this._authenticated.set(false)
    return this.getKeycloak().logout({ redirectUri: location.origin })
  }

  hasRealmRole(role: string): boolean {
    return this.keycloak?.hasRealmRole(role) ?? false
  }

  displayName(): string {
    const token = this.keycloak?.tokenParsed
    const name = token?.['name'] ?? token?.['preferred_username']
    return typeof name === 'string' ? name : 'Usuário autenticado'
  }

  async getToken(): Promise<string | null> {
    const keycloak = this.keycloak
    if (!keycloak?.authenticated) return null

    try {
      await keycloak.updateToken(MIN_TOKEN_VALIDITY_SECONDS)
      this._authenticated.set(true)
    } catch {
      keycloak.clearToken()
      this._authenticated.set(false)
      return null
    }

    return keycloak.token ?? null
  }

  private getKeycloak(): Keycloak {
    if (!this.keycloak) throw new Error('Authentication is not initialized')
    return this.keycloak
  }

  private async loadConfig(): Promise<KeycloakConfig> {
    const response = await fetch(AUTH_CONFIG_URL, { cache: 'no-store' })
    if (!response.ok) {
      throw new Error(
        `Unable to load authentication config: ${response.status}`,
      )
    }

    const config: unknown = await response.json()
    if (
      typeof config !== 'object' ||
      config === null ||
      !('url' in config) ||
      typeof config.url !== 'string' ||
      !('realm' in config) ||
      typeof config.realm !== 'string' ||
      !('clientId' in config) ||
      typeof config.clientId !== 'string'
    ) {
      throw new Error('Authentication config is invalid')
    }

    return {
      url: config.url,
      realm: config.realm,
      clientId: config.clientId,
    }
  }
}
