import { Logger, ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { MicroserviceOptions } from '@nestjs/microservices'
import { expenseRmqOptions } from './app/expense-rmq.options'
import { ExpenseModule } from './app/expense.module'

async function bootstrap() {
  const rmqOptions = expenseRmqOptions()
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    ExpenseModule,
    rmqOptions,
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
  Logger.log(
    `Expense microservice is consuming queue ${rmqOptions.options.queue}`,
  )
}

bootstrap()
