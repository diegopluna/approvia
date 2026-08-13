import { Module } from '@nestjs/common'
import { ExpenseController } from './expense.controller'
import { ExpenseService } from './expense.service'
import { PrismaService } from './prisma.service'
import { OutboxPublisher } from './outbox.publisher'

@Module({
  controllers: [ExpenseController],
  providers: [ExpenseService, PrismaService, OutboxPublisher],
})
export class ExpenseModule {}
