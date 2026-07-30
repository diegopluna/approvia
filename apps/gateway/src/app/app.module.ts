import { Module } from '@nestjs/common'
import { PassportModule } from '@nestjs/passport'
import { ClientsModule, Transport } from '@nestjs/microservices'
import { AppController } from './app.controller'
import { JwtStrategy } from './jwt.strategy'
import { RealmRoleGuard } from './realm-role.guard'
import { ApproverRoleGuard } from './approver-role.guard'
import { PurchaseRequestsController } from './purchase-requests/purchase-requests.controller'
import { PurchaseRequestsService } from './purchase-requests/purchase-requests.service'
import { RequesterRoleGuard } from './requester-role.guard'
import { EXPENSE_SERVICE } from './expense-client'

@Module({
  imports: [
    PassportModule,
    ClientsModule.registerAsync([
      {
        name: EXPENSE_SERVICE,
        useFactory: () => ({
          transport: Transport.TCP,
          options: {
            host: process.env.EXPENSE_SERVICE_HOST ?? '127.0.0.1',
            port: Number(process.env.EXPENSE_SERVICE_PORT ?? 3001),
          },
        }),
      },
    ]),
  ],
  controllers: [AppController, PurchaseRequestsController],
  providers: [
    JwtStrategy,
    RealmRoleGuard,
    ApproverRoleGuard,
    RequesterRoleGuard,
    PurchaseRequestsService,
  ],
})
export class AppModule {}
