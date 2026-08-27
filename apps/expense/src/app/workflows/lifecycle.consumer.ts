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
  Client,
  Connection,
  WorkflowExecutionAlreadyStartedError,
  WorkflowNotFoundError,
} from '@temporalio/client'
import {
  AmqpConnectionManager,
  ChannelWrapper,
  connect,
} from 'amqp-connection-manager'
import { ConsumeMessage } from 'amqplib'
import {
  APPROVAL_TASK_QUEUE,
  approvalWorkflowId,
  decisionTtlMs,
  reminderDelayMs,
  reminderIntervalMs,
  temporalAddress,
  temporalNamespace,
  workflowsEnabled,
} from './workflow.config'

const QUEUE = 'expense.workflows'
const LIFECYCLE_ROUTING_KEYS = [
  EXPENSE_EVENT_NAMES.created,
  EXPENSE_EVENT_NAMES.approved,
  EXPENSE_EVENT_NAMES.rejected,
] as const
const REQUEUE_DELAY_MS = 5000

// Consome os próprios eventos publicados pelo outbox para iniciar/sinalizar
// workflows de aprovação de forma confiável: reentregas são absorvidas pelo
// workflowId determinístico e por sinais a workflows já concluídos.
@Injectable()
export class LifecycleConsumer
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(LifecycleConsumer.name)
  private connection: AmqpConnectionManager | null = null
  private channel: ChannelWrapper | null = null
  private temporalConnection: Connection | null = null
  private temporalClient: Client | null = null

  onApplicationBootstrap() {
    if (!workflowsEnabled()) return

    this.connection = connect([
      process.env.RABBITMQ_URL ?? 'amqp://approvia:approvia@localhost:5672',
    ])
    this.connection.on('disconnect', ({ err }) =>
      this.logger.warn(`RabbitMQ disconnected: ${err.message}`),
    )
    this.channel = this.connection.createChannel({
      name: 'expense-lifecycle',
      setup: async (channel) => {
        await channel.assertExchange(APPLICATION_EVENTS_EXCHANGE, 'topic', {
          durable: true,
        })
        await channel.assertQueue(QUEUE, { durable: true })
        for (const routingKey of LIFECYCLE_ROUTING_KEYS) {
          await channel.bindQueue(QUEUE, APPLICATION_EVENTS_EXCHANGE, routingKey)
        }
        await channel.prefetch(5)
        await channel.consume(QUEUE, (message) => {
          if (message) void this.handle(message)
        })
      },
    })
  }

  async onModuleDestroy() {
    await this.channel?.close()
    await this.connection?.close()
    await this.temporalConnection?.close().catch(() => undefined)
  }

  private async handle(message: ConsumeMessage) {
    if (!this.channel) return

    let event: ExpenseIntegrationEvent
    try {
      event = parseExpenseIntegrationEvent(
        JSON.parse(message.content.toString('utf8')) as unknown,
      )
    } catch (error) {
      // Payload inválido nunca ficará válido: descarta com log.
      this.logger.error(`Discarding invalid event: ${this.message(error)}`)
      this.channel.ack(message)
      return
    }

    try {
      // Ack somente após o Temporal persistir o start/sinal.
      await this.dispatch(event)
      this.channel.ack(message)
    } catch (error) {
      this.logger.warn(
        `Workflow dispatch failed for ${event.eventName} ${event.aggregateId}: ${this.message(error)}`,
      )
      await new Promise((resolve) => setTimeout(resolve, REQUEUE_DELAY_MS))
      this.channel.nack(message, false, true)
    }
  }

  private async dispatch(event: ExpenseIntegrationEvent) {
    if (
      event.eventName === EXPENSE_EVENT_NAMES.reminder ||
      event.eventName === EXPENSE_EVENT_NAMES.expired
    ) {
      return
    }

    const client = await this.client()
    const workflowId = approvalWorkflowId(event.aggregateId)

    if (event.eventName === EXPENSE_EVENT_NAMES.created) {
      const request = event.data.request
      const decisionDeadlineAt =
        request.decisionDeadlineAt ??
        // Eventos anteriores ao prazo no snapshot: aplica o TTL configurado
        // a partir da criação para não deixar o workflow sem prazo.
        new Date(Date.parse(request.createdAt) + decisionTtlMs()).toISOString()
      try {
        await client.workflow.start('approvalWorkflow', {
          workflowId,
          taskQueue: APPROVAL_TASK_QUEUE,
          args: [
            {
              requestId: request.id,
              decisionDeadlineAt,
              reminderDelayMs: reminderDelayMs(),
              reminderIntervalMs: reminderIntervalMs(),
            },
          ],
        })
        this.logger.log(`Started ${workflowId}`)
      } catch (error) {
        if (error instanceof WorkflowExecutionAlreadyStartedError) return
        throw error
      }
      return
    }

    try {
      await client.workflow.getHandle(workflowId).signal('decided')
      this.logger.log(`Signalled decided on ${workflowId}`)
    } catch (error) {
      // Workflow inexistente ou já concluído: nada a cancelar.
      if (error instanceof WorkflowNotFoundError) return
      throw error
    }
  }

  private async client(): Promise<Client> {
    if (this.temporalClient) return this.temporalClient
    this.temporalConnection = await Connection.connect({
      address: temporalAddress(),
    })
    this.temporalClient = new Client({
      connection: this.temporalConnection,
      namespace: temporalNamespace(),
    })
    return this.temporalClient
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }
}
