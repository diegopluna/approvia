import { Module } from '@nestjs/common'
import { AppController } from './app.controller'
import { AppService, USER_SERVICE_CLIENT } from './app.service'
import { ClientsModule, Transport } from '@nestjs/microservices'

@Module({
  imports: [
    ClientsModule.register([
      {
        name: USER_SERVICE_CLIENT,
        transport: Transport.TCP,
        options: {
          host: process.env.USER_SERVICE_HOST ?? '127.0.0.1',
          port: Number(process.env.USER_SERVICE_PORT ?? 3001),
        },
      },
    ]),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
