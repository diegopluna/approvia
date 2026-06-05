import { LoginRequest, LoginResponse } from '@approvia/contracts'
import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common'
import axios from 'axios'

interface KeycloakConfig {
  baseUrl: string
  realm: string
  clientId: string
  clientSecret?: string
  scope?: string
}

interface KeycloakTokenResponse {
  access_token?: string
  refresh_token?: string
  id_token?: string
  expires_in?: number
  refresh_expires_in?: number
  token_type?: string
  'not-before-policy'?: number
  session_state?: string
  scope?: string
}

@Injectable()
export class AppService {
  async login(request: LoginRequest): Promise<LoginResponse> {
    if (!request?.email || !request?.password) {
      throw new BadRequestException('Email and password are required')
    }

    const config = this.getKeycloakConfig()
    const tokenUrl = `${config.baseUrl.replace(/\/$/, '')}/realms/${encodeURIComponent(config.realm)}/protocol/openid-connect/token`
    const form = new URLSearchParams()
    form.set('grant_type', 'password')
    form.set('client_id', config.clientId)
    form.set('email', request.email)
    form.set('password', request.password)

    if (config.clientSecret) {
      form.set('client_secret', config.clientSecret)
    }

    if (config.scope) {
      form.set('scope', config.scope)
    }

    let data: KeycloakTokenResponse

    try {
      const response = await axios.post<KeycloakTokenResponse>(tokenUrl, form, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })
      data = response.data
    } catch (error) {
      this.handleKeycloakError(error)
    }

    if (!data.access_token) {
      throw new BadGatewayException(
        'Keycloak token response did not include an access token',
      )
    }

    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      id_token: data.id_token,
      expires_in: data.expires_in,
      refresh_expires_in: data.refresh_expires_in,
      token_type: data.token_type,
      'not-before-policy': data['not-before-policy'],
      session_state: data.session_state,
      scope: data.scope,
    }
  }

  private getKeycloakConfig(): KeycloakConfig {
    const baseUrl = process.env.KEYCLOAK_BASE_URL
    const realm = process.env.KEYCLOAK_REALM
    const clientId = process.env.KEYCLOAK_CLIENT_ID

    const missing = [
      !baseUrl && 'KEYCLOACK_BASE_URL',
      !realm && 'KEYCLOAK_REALM',
      !clientId && 'KEYCLOAK_CLIENT_ID',
    ].filter((value): value is string => Boolean(value))

    if (missing.length > 0) {
      throw new InternalServerErrorException(
        `Missing required Keycloak env vars: ${missing.join(', ')}`,
      )
    }

    return {
      baseUrl: baseUrl as string,
      realm: realm as string,
      clientId: clientId as string,
      clientSecret: process.env.KEYCLOAK_CLIENT_SECRET,
      scope: process.env.KEYCLOAK_SCOPE,
    }
  }

  private handleKeycloakError(error: unknown): never {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status

      if (status === 400 || status === 401) {
        throw new UnauthorizedException('Invalid email or password')
      }

      if (status === 404) {
        throw new BadGatewayException(
          'Keycloak realm or token endpoint was not found',
        )
      }

      throw new BadGatewayException('Unable to authenticate with Keycloak')
    }

    throw new BadGatewayException('Unable to authenticate with Keycloak')
  }
}
