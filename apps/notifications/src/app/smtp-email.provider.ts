import { Injectable } from '@nestjs/common'
import nodemailer, { Transporter } from 'nodemailer'
import { EmailMessage, EmailProvider } from './email.provider'
import { NotificationError } from './notification.error'

@Injectable()
export class SmtpEmailProvider implements EmailProvider {
  private readonly transporter: Transporter

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST ?? 'localhost',
      port: Number(process.env.SMTP_PORT ?? 1026),
      secure: process.env.SMTP_SECURE === 'true',
      auth:
        process.env.SMTP_USER && process.env.SMTP_PASSWORD
          ? {
              user: process.env.SMTP_USER,
              pass: process.env.SMTP_PASSWORD,
            }
          : undefined,
    })
  }

  async send(message: EmailMessage): Promise<string | null> {
    try {
      const result = await this.transporter.sendMail({
        from: process.env.EMAIL_FROM ?? 'Approvia <noreply@approvia.local>',
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        headers: { 'X-Idempotency-Key': message.idempotencyKey },
      })
      return typeof result.messageId === 'string' ? result.messageId : null
    } catch (error) {
      throw new NotificationError(
        error instanceof Error ? error.message : 'SMTP delivery failed',
        true,
      )
    }
  }
}
