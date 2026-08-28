import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common'
import {
  APPLICATION_EVENTS_EXCHANGE,
  EXPENSE_EVENT_NAMES,
  ExpenseIntegrationEvent,
  parseExpenseIntegrationEvent,
} from '@approvia/events'
import {
  AmqpConnectionManager,
  ChannelWrapper,
  connect,
} from 'amqp-connection-manager'
import { ConsumeMessage, Options } from 'amqplib'
import { EmailDeliveryService } from './email-delivery.service'
import { KeycloakRecipientService } from './keycloak-recipient.service'
import { NotificationError } from './notification.error'

const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000]
const DEAD_LETTER_EXCHANGE = 'approvia.dead-letter'

@Injectable()
export class NotificationsConsumer
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(NotificationsConsumer.name)
  private connection: AmqpConnectionManager | null = null
  private channel: ChannelWrapper | null = null
  private readonly queue =
    process.env.NOTIFICATIONS_QUEUE ?? 'notifications.email.v1'

  constructor(
    private readonly recipients: KeycloakRecipientService,
    private readonly deliveries: EmailDeliveryService,
  ) {}

  async onApplicationBootstrap() {
    this.connection = connect([
      process.env.RABBITMQ_URL ?? 'amqp://approvia:approvia@localhost:5672',
    ])
    this.connection.on('connect', () =>
      this.logger.log('Connected to RabbitMQ'),
    )
    this.connection.on('disconnect', ({ err }) =>
      this.logger.warn(`RabbitMQ disconnected: ${err.message}`),
    )
    this.channel = this.connection.createChannel({
      name: 'notifications-consumer',
      publishTimeout: Number(
        process.env.NOTIFICATIONS_PUBLISH_TIMEOUT_MS ?? 5000,
      ),
      setup: async (channel) => {
        await channel.assertExchange(APPLICATION_EVENTS_EXCHANGE, 'topic', {
          durable: true,
        })
        await channel.assertExchange(DEAD_LETTER_EXCHANGE, 'topic', {
          durable: true,
        })
        await channel.assertQueue(this.queue, { durable: true })
        await channel.bindQueue(
          this.queue,
          APPLICATION_EVENTS_EXCHANGE,
          'expense.request.*.v1',
        )

        const deadLetterQueue = `${this.queue}.dead-letter`
        await channel.assertQueue(deadLetterQueue, { durable: true })
        await channel.bindQueue(deadLetterQueue, DEAD_LETTER_EXCHANGE, '#')

        for (const [index, delay] of RETRY_DELAYS_MS.entries()) {
          const exchange = this.retryExchange(index)
          const queue = this.retryQueue(index)
          await channel.assertExchange(exchange, 'topic', { durable: true })
          await channel.assertQueue(queue, {
            durable: true,
            arguments: {
              'x-message-ttl': delay,
              'x-dead-letter-exchange': APPLICATION_EVENTS_EXCHANGE,
            },
          })
          await channel.bindQueue(queue, exchange, '#')
        }
      },
    })
    await this.channel.consume(
      this.queue,
      (message) => {
        if (message) void this.handle(message)
      },
      {
        noAck: false,
        prefetch: Number(process.env.NOTIFICATIONS_PREFETCH ?? 5),
      },
    )
  }

  async onModuleDestroy() {
    await this.channel?.close()
    await this.connection?.close()
  }

  private async handle(message: ConsumeMessage) {
    if (!this.channel) return

    let event: ExpenseIntegrationEvent
    try {
      event = parseExpenseIntegrationEvent(
        JSON.parse(message.content.toString('utf8')) as unknown,
      )
    } catch (error) {
      await this.deadLetter(message, this.errorMessage(error))
      return
    }

    try {
      const recipients = await this.resolveRecipients(event)
      for (const recipient of recipients) {
        await this.deliveries.deliver(event, recipient)
      }
      this.channel.ack(message)
      this.logger.log(
        `Delivered ${event.eventName} event ${event.eventId} to ${recipients.length} recipient(s)`,
      )
    } catch (error) {
      if (error instanceof NotificationError && !error.transient) {
        await this.deadLetter(message, this.errorMessage(error))
        return
      }
      await this.retry(message, this.errorMessage(error))
    }
  }

  private async resolveRecipients(
    event: ExpenseIntegrationEvent,
  ): Promise<string[]> {
    // Aprovadores elegíveis no momento do envio (mesma regra do created).
    if (
      event.eventName === EXPENSE_EVENT_NAMES.created ||
      event.eventName === EXPENSE_EVENT_NAMES.reminder
    ) {
      return (await this.recipients.approvers()).map(({ email }) => email)
    }
    const requesterEmail = event.data.request.requesterEmail?.trim()
    if (!requesterEmail) {
      // Sem destinatário não há entrega possível; caso tratado, não erro.
      this.logger.warn(
        `Event ${event.eventId} has no requester email; skipping delivery`,
      )
      return []
    }
    return [requesterEmail]
  }

  private async retry(message: ConsumeMessage, error: string) {
    if (!this.channel) return
    const attempt = this.retryAttempt(message) + 1
    if (attempt > RETRY_DELAYS_MS.length) {
      await this.deadLetter(message, error)
      return
    }

    try {
      await this.channel.publish(
        this.retryExchange(attempt - 1),
        message.fields.routingKey,
        message.content,
        this.publishOptions(message, attempt, error),
      )
      this.channel.ack(message)
      this.logger.warn(
        `Scheduled notification retry ${attempt}/${RETRY_DELAYS_MS.length}: ${error}`,
      )
    } catch (publishError) {
      this.logger.error(
        `Unable to schedule retry: ${this.errorMessage(publishError)}`,
      )
      this.channel.nack(message, false, true)
    }
  }

  private async deadLetter(message: ConsumeMessage, error: string) {
    if (!this.channel) return
    try {
      await this.channel.publish(
        DEAD_LETTER_EXCHANGE,
        message.fields.routingKey,
        message.content,
        this.publishOptions(message, this.retryAttempt(message), error),
      )
      this.channel.ack(message)
      this.logger.error(`Notification moved to dead-letter queue: ${error}`)
    } catch (publishError) {
      this.logger.error(
        `Unable to dead-letter notification: ${this.errorMessage(publishError)}`,
      )
      this.channel.nack(message, false, true)
    }
  }

  private publishOptions(
    message: ConsumeMessage,
    attempt: number,
    error: string,
  ): Options.Publish {
    return {
      contentType: message.properties.contentType ?? 'application/json',
      correlationId: message.properties.correlationId,
      messageId: message.properties.messageId,
      persistent: true,
      timestamp: message.properties.timestamp,
      headers: {
        ...message.properties.headers,
        'x-retry-attempt': attempt,
        'x-last-error': error.slice(0, 500),
      },
    }
  }

  private retryAttempt(message: ConsumeMessage): number {
    const value = message.properties.headers?.['x-retry-attempt']
    return typeof value === 'number' && Number.isInteger(value) ? value : 0
  }

  private retryExchange(index: number): string {
    return `${this.queue}.retry.${index + 1}`
  }

  private retryQueue(index: number): string {
    return `${this.retryExchange(index)}.queue`
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }
}
