import { Logger, ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { MicroserviceOptions, Transport } from '@nestjs/microservices'
import { ExpenseModule } from './app/expense.module'

async function bootstrap() {
  const queue = process.env.EXPENSE_SERVICE_QUEUE ?? 'expense'
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    ExpenseModule,
    {
      transport: Transport.RMQ,
      options: {
        urls: [
          process.env.RABBITMQ_URL ?? 'amqp://approvia:approvia@localhost:5672',
        ],
        queue,
        queueOptions: {
          durable: process.env.EXPENSE_SERVICE_QUEUE_DURABLE !== 'false',
          autoDelete: process.env.EXPENSE_SERVICE_QUEUE_DURABLE === 'false',
        },
      },
    },
  )

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  app.enableShutdownHooks()
  await app.listen()
  Logger.log(`Expense microservice is consuming queue ${queue}`)
}

bootstrap()
