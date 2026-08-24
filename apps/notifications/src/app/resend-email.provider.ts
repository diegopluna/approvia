import { Injectable } from '@nestjs/common'
import { Resend } from 'resend'
import { EmailMessage, EmailProvider } from './email.provider'
import { NotificationError } from './notification.error'

@Injectable()
export class ResendEmailProvider implements EmailProvider {
  private readonly client: Resend

  constructor() {
    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) throw new Error('RESEND_API_KEY is required for Resend')
    this.client = new Resend(apiKey)
  }

  async send(message: EmailMessage): Promise<string | null> {
    const result = await this.client.emails.send(
      {
        from: process.env.EMAIL_FROM ?? 'Approvia <noreply@approvia.dev>',
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
      },
      { idempotencyKey: message.idempotencyKey },
    )

    if (result.error) {
      const statusCode = result.error.statusCode
      throw new NotificationError(
        result.error.message,
        statusCode === 429 || statusCode >= 500,
      )
    }
    return result.data?.id ?? null
  }
}
