import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { NotificationsModule } from './app/notifications.module'

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(NotificationsModule)
  app.enableShutdownHooks()
  Logger.log('Notifications worker started')
}

bootstrap()
