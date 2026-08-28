import { Module } from '@nestjs/common'
import { EMAIL_PROVIDER } from './email.provider'
import { EmailDeliveryService } from './email-delivery.service'
import { EmailTemplateService } from './email-template.service'
import { KeycloakRecipientService } from './keycloak-recipient.service'
import { NotificationsConsumer } from './notifications.consumer'
import { PrismaService } from './prisma.service'
import { ResendEmailProvider } from './resend-email.provider'
import { SmtpEmailProvider } from './smtp-email.provider'

@Module({
  providers: [
    PrismaService,
    EmailTemplateService,
    KeycloakRecipientService,
    EmailDeliveryService,
    NotificationsConsumer,
    SmtpEmailProvider,
    {
      provide: EMAIL_PROVIDER,
      inject: [SmtpEmailProvider],
      useFactory: (smtp: SmtpEmailProvider) => {
        const provider = process.env.EMAIL_PROVIDER ?? 'smtp'
        if (provider === 'smtp') return smtp
        if (provider === 'resend') return new ResendEmailProvider()
        throw new Error(`Unsupported EMAIL_PROVIDER: ${provider}`)
      },
    },
  ],
})
export class NotificationsModule {}
