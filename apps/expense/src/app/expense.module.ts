import { Module } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { ExpenseController } from './expense.controller'
import { ExpenseService } from './expense.service'
import { PrismaService } from './prisma.service'
import { RmqAckInterceptor } from './rmq-ack.interceptor'
import { OutboxPublisher } from './outbox.publisher'
import { LifecycleConsumer } from './workflows/lifecycle.consumer'
import { WorkflowWorker } from './workflows/workflow.worker'

@Module({
  controllers: [ExpenseController],
  providers: [
    ExpenseService,
    PrismaService,
    OutboxPublisher,
    LifecycleConsumer,
    WorkflowWorker,
    { provide: APP_INTERCEPTOR, useClass: RmqAckInterceptor },
  ],
})
export class ExpenseModule {}
