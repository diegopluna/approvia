export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER')

export type EmailMessage = {
  to: string
  subject: string
  html: string
  text: string
  idempotencyKey: string
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<string | null>
}
