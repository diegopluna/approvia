import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common'
import { APPLICATION_EVENTS_EXCHANGE } from '@approvia/events'
import {
  connect,
  AmqpConnectionManager,
  ChannelWrapper,
} from 'amqp-connection-manager'
import { PrismaService } from './prisma.service'

const BATCH_SIZE = 20
const DEFAULT_INTERVAL_MS = 1000
const CLAIM_TIMEOUT_MINUTES = 5

@Injectable()
export class OutboxPublisher
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(OutboxPublisher.name)
  private connection: AmqpConnectionManager | null = null
  private channel: ChannelWrapper | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private publishing = false

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap() {
    if (process.env.OUTBOX_PUBLISHER_ENABLED === 'false') return

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
      name: 'expense-outbox',
      publishTimeout: Number(process.env.OUTBOX_PUBLISH_TIMEOUT_MS ?? 5000),
      setup: async (channel) => {
        await channel.assertExchange(APPLICATION_EVENTS_EXCHANGE, 'topic', {
          durable: true,
        })
      },
    })

    const interval = Number(
      process.env.OUTBOX_PUBLISH_INTERVAL_MS ?? DEFAULT_INTERVAL_MS,
    )
    this.timer = setInterval(() => void this.publishBatch(), interval)
    void this.publishBatch()
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
    await this.channel?.close()
    await this.connection?.close()
  }

  private async publishBatch() {
    if (this.publishing || !this.channel) return
    this.publishing = true

    try {
      const claimed = await this.prisma.$queryRaw<{ id: string }[]>`
        UPDATE "outbox_events"
        SET "processing_at" = NOW()
        WHERE "id" IN (
          SELECT "id"
          FROM "outbox_events"
          WHERE "published_at" IS NULL
            AND (
              "processing_at" IS NULL
              OR "processing_at" < NOW() - (${CLAIM_TIMEOUT_MINUTES} * INTERVAL '1 minute')
            )
          ORDER BY "occurred_at" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT ${BATCH_SIZE}
        )
        RETURNING "id"
      `
      if (claimed.length === 0) return

      const events = await this.prisma.outboxEvent.findMany({
        where: { id: { in: claimed.map(({ id }) => id) } },
        orderBy: { occurredAt: 'asc' },
      })

      for (const event of events) {
        try {
          await this.channel.publish(
            APPLICATION_EVENTS_EXCHANGE,
            event.eventName,
            event.payload,
            {
              persistent: true,
              contentType: 'application/json',
              messageId: event.id,
              correlationId: event.id,
              timestamp: event.occurredAt.getTime(),
            },
          )
          await this.prisma.outboxEvent.update({
            where: { id: event.id },
            data: {
              publishedAt: new Date(),
              processingAt: null,
              attempts: { increment: 1 },
              lastError: null,
            },
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          this.logger.warn(
            `Failed to publish outbox event ${event.id}: ${message}`,
          )
          await this.prisma.outboxEvent.update({
            where: { id: event.id },
            data: {
              processingAt: null,
              attempts: { increment: 1 },
              lastError: message.slice(0, 4000),
            },
          })
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.error(`Outbox polling failed: ${message}`)
    } finally {
      this.publishing = false
    }
  }
}
