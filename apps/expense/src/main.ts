import { Logger, ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { MicroserviceOptions, Transport } from '@nestjs/microservices'
import { ExpenseModule } from './app/expense.module'

async function bootstrap() {
  const port = Number(process.env.EXPENSE_SERVICE_PORT ?? 3001)
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    ExpenseModule,
    {
      transport: Transport.TCP,
      options: {
        host: process.env.EXPENSE_SERVICE_BIND_HOST ?? '127.0.0.1',
        port,
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
  Logger.log(`Expense microservice is listening on port ${port}`)
}

bootstrap()
