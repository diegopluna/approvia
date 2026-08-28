import { RmqOptions, Transport } from '@nestjs/microservices'

// Config única do consumidor RMQ do expense, compartilhada entre o bootstrap
// de produção (main.ts) e o harness e2e, para que ambos rodem o mesmo
// comportamento de ack/prefetch.
export function expenseRmqOptions() {
  const durable = process.env.EXPENSE_SERVICE_QUEUE_DURABLE !== 'false'

  return {
    transport: Transport.RMQ,
    options: {
      urls: [
        process.env.RABBITMQ_URL ?? 'amqp://approvia:approvia@localhost:5672',
      ],
      queue: process.env.EXPENSE_SERVICE_QUEUE ?? 'expense',
      // Ack manual (via RmqAckInterceptor) após o handler concluir: uma
      // mensagem em processamento durante um crash volta para a fila.
      noAck: false,
      prefetchCount: parsePrefetch(process.env.EXPENSE_SERVICE_PREFETCH),
      queueOptions: {
        durable,
        autoDelete: !durable,
      },
    },
  } satisfies RmqOptions
}

// Prefetch 0 significa "sem limite" no RabbitMQ, então valores vazios,
// não numéricos ou não positivos caem no padrão em vez de desligar o
// backpressure por engano.
function parsePrefetch(raw: string | undefined): number {
  const value = Number(raw)
  return Number.isInteger(value) && value > 0 ? value : 16
}
