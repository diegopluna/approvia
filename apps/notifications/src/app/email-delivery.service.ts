import { Inject, Injectable } from '@nestjs/common'
import { ExpenseIntegrationEvent } from '@approvia/events'
import { Prisma, EmailDeliveryStatus } from '../generated/prisma/client'
import { EMAIL_PROVIDER, EmailProvider } from './email.provider'
import { EmailTemplateService } from './email-template.service'
import { NotificationError } from './notification.error'
import { PrismaService } from './prisma.service'

@Injectable()
export class EmailDeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly templates: EmailTemplateService,
    @Inject(EMAIL_PROVIDER) private readonly provider: EmailProvider,
  ) {}

  async deliver(event: ExpenseIntegrationEvent, recipient: string) {
    const email = recipient.trim().toLowerCase()
    const rendered = this.templates.render(event)
    const unique = {
      eventId: event.eventId,
      recipient: email,
      template: rendered.template,
      templateVersion: rendered.templateVersion,
    }
    const delivery = await this.prisma.emailDelivery.upsert({
      where: { eventId_recipient_template_templateVersion: unique },
      create: {
        ...unique,
        eventName: event.eventName,
        templateData: rendered.data as Prisma.InputJsonValue,
      },
      update: {},
    })
    if (
      delivery.status === EmailDeliveryStatus.SENT ||
      delivery.status === EmailDeliveryStatus.FAILED
    ) {
      return
    }

    const staleClaim = new Date(
      Date.now() - Number(process.env.NOTIFICATIONS_CLAIM_TIMEOUT_MS ?? 300000),
    )
    const claimed = await this.prisma.emailDelivery.updateMany({
      where: {
        id: delivery.id,
        OR: [
          {
            status: {
              in: [EmailDeliveryStatus.PENDING, EmailDeliveryStatus.RETRYING],
            },
          },
          {
            status: EmailDeliveryStatus.SENDING,
            updatedAt: { lt: staleClaim },
          },
        ],
      },
      data: {
        status: EmailDeliveryStatus.SENDING,
        attempts: { increment: 1 },
        lastError: null,
      },
    })
    if (claimed.count === 0) return

    try {
      const providerMessageId = await this.provider.send({
        to: email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        idempotencyKey: [
          event.eventId,
          email,
          rendered.template,
          `v${rendered.templateVersion}`,
        ].join(':'),
      })
      await this.prisma.emailDelivery.update({
        where: { id: delivery.id },
        data: {
          status: EmailDeliveryStatus.SENT,
          providerMessageId,
          sentAt: new Date(),
        },
      })
    } catch (error) {
      const transient =
        error instanceof NotificationError ? error.transient : true
      const message = error instanceof Error ? error.message : String(error)
      await this.prisma.emailDelivery.update({
        where: { id: delivery.id },
        data: {
          status: transient
            ? EmailDeliveryStatus.RETRYING
            : EmailDeliveryStatus.FAILED,
          lastError: message.slice(0, 4000),
        },
      })
      throw error
    }
  }
}
