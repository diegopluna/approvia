import { Injectable } from '@nestjs/common'
import { NotificationError } from './notification.error'

export type EmailRecipient = {
  email: string
  name: string
}

type KeycloakUser = {
  enabled?: unknown
  email?: unknown
  firstName?: unknown
  lastName?: unknown
  username?: unknown
}

@Injectable()
export class KeycloakRecipientService {
  private cachedApprovers: EmailRecipient[] | null = null
  private cacheExpiresAt = 0

  async approvers(): Promise<EmailRecipient[]> {
    if (this.cachedApprovers && Date.now() < this.cacheExpiresAt) {
      return this.cachedApprovers
    }

    const baseUrl = process.env.KEYCLOAK_BASE_URL ?? 'http://localhost:8080'
    const realm = process.env.KEYCLOAK_REALM ?? 'approvia'
    const token = await this.serviceToken(baseUrl, realm)
    const role = encodeURIComponent(
      process.env.KEYCLOAK_APPROVER_ROLE ?? 'approver',
    )
    const response = await this.fetchWithTimeout(
      `${baseUrl}/admin/realms/${encodeURIComponent(realm)}/roles/${role}/users?first=0&max=1000`,
      { headers: { authorization: `Bearer ${token}` } },
    )
    if (!response.ok) {
      throw new NotificationError(
        `Keycloak role lookup failed with ${response.status}`,
        response.status >= 500 || response.status === 429,
      )
    }

    const users: unknown = await response.json()
    if (!Array.isArray(users)) {
      throw new NotificationError('Keycloak role response is invalid', false)
    }
    const recipients = users
      .filter(
        (user): user is KeycloakUser =>
          typeof user === 'object' && user !== null,
      )
      .filter(
        (user) => user.enabled !== false && typeof user.email === 'string',
      )
      .map((user) => ({
        email: user.email as string,
        name:
          [user.firstName, user.lastName]
            .filter(
              (part): part is string => typeof part === 'string' && !!part,
            )
            .join(' ') ||
          (typeof user.username === 'string'
            ? user.username
            : (user.email as string)),
      }))

    if (recipients.length === 0) {
      throw new NotificationError(
        'No enabled approvers with email were found',
        false,
      )
    }
    this.cachedApprovers = recipients
    this.cacheExpiresAt =
      Date.now() + Number(process.env.KEYCLOAK_RECIPIENT_CACHE_MS ?? 300000)
    return recipients
  }

  private async serviceToken(baseUrl: string, realm: string): Promise<string> {
    const clientId =
      process.env.KEYCLOAK_NOTIFICATIONS_CLIENT_ID ?? 'notifications'
    const clientSecret = process.env.KEYCLOAK_NOTIFICATIONS_CLIENT_SECRET
    if (!clientSecret) {
      throw new NotificationError(
        'KEYCLOAK_NOTIFICATIONS_CLIENT_SECRET is required',
        false,
      )
    }

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    })
    const response = await this.fetchWithTimeout(
      `${baseUrl}/realms/${encodeURIComponent(realm)}/protocol/openid-connect/token`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      },
    )
    if (!response.ok) {
      throw new NotificationError(
        `Keycloak service authentication failed with ${response.status}`,
        response.status >= 500 || response.status === 429,
      )
    }
    const result: unknown = await response.json()
    if (
      typeof result !== 'object' ||
      result === null ||
      !('access_token' in result) ||
      typeof result.access_token !== 'string'
    ) {
      throw new NotificationError('Keycloak token response is invalid', false)
    }
    return result.access_token
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    try {
      return await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(
          Number(process.env.KEYCLOAK_REQUEST_TIMEOUT_MS ?? 5000),
        ),
      })
    } catch (error) {
      throw new NotificationError(
        error instanceof Error ? error.message : 'Keycloak request failed',
        true,
      )
    }
  }
}
