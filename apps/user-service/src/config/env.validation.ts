export interface KeycloakEnv {
  KEYCLOAK_BASE_URL: string
  KEYCLOAK_REALM: string
  KEYCLOAK_CLIENT_ID: string
  KEYCLOAK_CLIENT_SECRET: string
  KEYCLOAK_SCOPE?: string
}

export function validateEnv(config: Record<string, unknown>) {
  const required = [
    'KEYCLOAK_BASE_URL',
    'KEYCLOAK_REALM',
    'KEYCLOAK_CLIENT_ID',
    'KEYCLOAK_CLIENT_SECRET',
  ]
  const missing = required.filter((key) => !config[key])
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`)
  }
  return config
}
