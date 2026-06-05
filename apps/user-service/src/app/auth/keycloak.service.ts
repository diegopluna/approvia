import { LoginResponse, LogoutResponse } from '@approvia/contracts'
import {
  BadGatewayException,
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Client, errors, Issuer, TokenSet } from 'openid-client'

@Injectable()
export class KeycloakService implements OnModuleInit {
  private readonly logger = new Logger(KeycloakService.name)
  private client!: Client
  private issuer!: Issuer<Client>

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    const baseUrl = this.config.getOrThrow<string>('KEYCLOAK_BASE_URL')
    const realm = this.config.getOrThrow<string>('KEYCLOAK_REALM')

    this.issuer = await Issuer.discover(`${baseUrl}/realms/${realm}`)
    this.client = new this.issuer.Client({
      client_id: this.config.getOrThrow<string>('KEYCLOAK_CLIENT_ID'),
      client_secret: this.config.getOrThrow<string>('KEYCLOAK_CLIENT_SECRET'),
    })
    this.logger.log(`Keycloak discovered at realm "${realm}"`)
  }

  async login(email: string, password: string): Promise<LoginResponse> {
    try {
      const tokenSet = await this.client.grant({
        grant_type: 'password',
        username: email,
        password,
        scope: this.config.get<string>('KEYCLOAK_SCOPE') ?? 'openid',
      })
      return this.toLoginResponse(tokenSet)
    } catch (error) {
      this.handleError(error)
    }
  }

  async refresh(refreshToken: string): Promise<LoginResponse> {
    try {
      const tokenSet = await this.client.refresh(refreshToken)
      return this.toLoginResponse(tokenSet)
    } catch (error) {
      this.handleError(error)
    }
  }

  async logout(refreshToken: string): Promise<LogoutResponse> {
    try {
      await this.client.revoke(refreshToken, 'refresh_token')
      return { success: true }
    } catch (error) {
      this.handleError(error)
    }
  }

  private toLoginResponse(tokenSet: TokenSet): LoginResponse {
    if (!tokenSet.access_token) {
      throw new BadGatewayException('Keycloak returned no access_token')
    }
    return {
      access_token: tokenSet.access_token,
      refresh_token: tokenSet.refresh_token,
      id_token: tokenSet.id_token,
      expires_in: tokenSet.expires_at
        ? tokenSet.expires_at - Math.floor(Date.now() / 1000)
        : undefined,
      token_type: tokenSet.token_type,
      scope: tokenSet.scope,
      session_state: (tokenSet as Record<string, unknown>).session_state as
        | string
        | undefined,
    }
  }

  private handleError(error: unknown): never {
    if (error instanceof errors.OPError) {
      const code = error.error
      if (code === 'invalid_grant' || code === 'unauthorized_client') {
        throw new UnauthorizedException('Invalid email or password')
      }
    }
    this.logger.error('Keycloak request failed', error as Error)
    throw new BadGatewayException('Unable to authenticate with Keycloak')
  }
}
