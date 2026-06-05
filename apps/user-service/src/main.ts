import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app/app.module'
import { MicroserviceOptions, Transport } from '@nestjs/microservices'

async function bootstrap() {
  const host = process.env.USER_SERVICE_HOST ?? '0.0.0.0'
  const port = Number(process.env.USER_SERVICE_PORT ?? 3001)

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.TCP,
      options: { host, port },
    },
  )

  await app.listen()
  Logger.log(
    `🚀 User service microsservice is listening on tcp://:${host}:${port}`,
  )
}

bootstrap()
