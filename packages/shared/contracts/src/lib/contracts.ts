export const USER_SERVICE_PATTERNS = {
  LOGIN: 'user.login',
} as const

export interface LoginRequest {
  email: string
  password: string
}

export interface LoginResponse {
  access_token: string
  refresh_token?: string
  id_token?: string
  expires_in?: number
  refresh_expires_in?: number
  token_type?: string
  'not-before-policy'?: number
  session_state?: string
  scope?: string
}
