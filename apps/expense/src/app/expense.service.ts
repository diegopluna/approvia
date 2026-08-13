import { Inject, Injectable } from '@nestjs/common'
import { RpcException } from '@nestjs/microservices'
import {
  EXPENSE_EVENT_NAMES,
  ExpenseIntegrationEvent,
  ExpenseRequestSnapshot,
} from '@approvia/events'
import { randomUUID } from 'node:crypto'
import {
  Prisma,
  PurchaseRequest,
  PurchaseRequestStatus,
} from '../generated/prisma/client'
import { PrismaService } from './prisma.service'

export type ExpenseUser = {
  id: string
  name: string
  email: string
}

export type CreateExpenseRequest = {
  title: string
  amount: string
  justification: string
}

export type DecideExpenseRequest = {
  decision: 'APPROVED' | 'REJECTED'
  comment?: string
}

@Injectable()
export class ExpenseService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(user: ExpenseUser, input: CreateExpenseRequest) {
    const amountMinor = this.toMinorUnits(input.amount)
    if (amountMinor === 0) {
      this.fail(400, 'O valor deve ser maior que zero')
    }

    const request = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.purchaseRequest.create({
        data: {
          title: input.title.trim(),
          justification: input.justification.trim(),
          amountMinor,
          requesterId: user.id,
          requesterName: user.name,
          requesterEmail: user.email,
        },
      })
      await this.writeOutboxEvent(
        transaction,
        this.createdEvent(created, randomUUID()),
      )
      return created
    })

    return this.toResponse(request)
  }

  async mine(user: ExpenseUser) {
    const requests = await this.prisma.purchaseRequest.findMany({
      where: { requesterId: user.id },
      orderBy: { createdAt: 'desc' },
    })

    return requests.map((request) => this.toResponse(request))
  }

  async pending(user: ExpenseUser) {
    const requests = await this.prisma.purchaseRequest.findMany({
      where: {
        status: PurchaseRequestStatus.PENDING,
        requesterId: { not: user.id },
      },
      orderBy: { createdAt: 'asc' },
    })

    return requests.map((request) => this.toResponse(request))
  }

  async approved(user: ExpenseUser) {
    const requests = await this.prisma.purchaseRequest.findMany({
      where: {
        status: PurchaseRequestStatus.APPROVED,
        decidedById: user.id,
      },
      orderBy: { decidedAt: 'desc' },
    })

    return requests.map((request) => this.toResponse(request))
  }

  async decide(user: ExpenseUser, id: string, input: DecideExpenseRequest) {
    const decidedRequest = await this.prisma.$transaction(
      async (transaction) => {
        const request = await transaction.purchaseRequest.findUnique({
          where: { id },
        })

        if (!request) this.fail(404, 'Solicitação não encontrada')
        if (request.requesterId === user.id) {
          this.fail(403, 'Você não pode decidir sua própria solicitação')
        }
        if (request.status !== PurchaseRequestStatus.PENDING) {
          this.fail(409, 'A solicitação já foi decidida')
        }

        const comment = input.comment?.trim() || null
        if (input.decision === 'REJECTED' && !comment) {
          this.fail(400, 'Informe o motivo da rejeição')
        }

        const decidedAt = new Date()
        const result = await transaction.purchaseRequest.updateMany({
          where: { id, status: PurchaseRequestStatus.PENDING },
          data: {
            status: input.decision,
            decidedById: user.id,
            decidedByName: user.name,
            decisionComment: comment,
            decidedAt,
          },
        })

        if (result.count === 0) this.fail(409, 'A solicitação já foi decidida')

        const decided = await transaction.purchaseRequest.findUniqueOrThrow({
          where: { id },
        })
        if (decided.requesterEmail) {
          await this.writeOutboxEvent(
            transaction,
            this.decidedEvent(
              decided,
              user.name,
              comment,
              decidedAt,
              randomUUID(),
            ),
          )
        }
        return decided
      },
    )
    return this.toResponse(decidedRequest)
  }

  private createdEvent(
    request: PurchaseRequest,
    eventId: string,
  ): ExpenseIntegrationEvent {
    return {
      eventId,
      eventName: EXPENSE_EVENT_NAMES.created,
      aggregateId: request.id,
      correlationId: eventId,
      occurredAt: request.createdAt.toISOString(),
      data: { request: this.eventSnapshot(request) },
    }
  }

  private decidedEvent(
    request: PurchaseRequest,
    decidedByName: string,
    comment: string | null,
    decidedAt: Date,
    eventId: string,
  ): ExpenseIntegrationEvent {
    const status =
      request.status === PurchaseRequestStatus.APPROVED
        ? ('APPROVED' as const)
        : ('REJECTED' as const)
    return {
      eventId,
      eventName:
        status === 'APPROVED'
          ? EXPENSE_EVENT_NAMES.approved
          : EXPENSE_EVENT_NAMES.rejected,
      aggregateId: request.id,
      correlationId: eventId,
      occurredAt: decidedAt.toISOString(),
      data: {
        request: this.eventSnapshot(request),
        decision: {
          status,
          decidedByName,
          comment,
          decidedAt: decidedAt.toISOString(),
        },
      },
    }
  }

  private eventSnapshot(request: PurchaseRequest): ExpenseRequestSnapshot {
    if (!request.requesterEmail) {
      this.fail(422, 'Solicitação sem email do solicitante')
    }
    return {
      id: request.id,
      title: request.title,
      amountMinor: request.amountMinor,
      currency: request.currency,
      requesterId: request.requesterId,
      requesterName: request.requesterName,
      requesterEmail: request.requesterEmail,
      createdAt: request.createdAt.toISOString(),
    }
  }

  private async writeOutboxEvent(
    transaction: Prisma.TransactionClient,
    event: ExpenseIntegrationEvent,
  ) {
    await transaction.outboxEvent.create({
      data: {
        id: event.eventId,
        eventName: event.eventName,
        aggregateId: event.aggregateId,
        payload: event as unknown as Prisma.InputJsonValue,
        occurredAt: new Date(event.occurredAt),
      },
    })
  }

  private toMinorUnits(amount: string): number {
    const [whole, decimal = ''] = amount.split('.')
    return Number(whole) * 100 + Number(decimal.padEnd(2, '0'))
  }

  private toResponse(request: PurchaseRequest) {
    return {
      id: request.id,
      title: request.title,
      justification: request.justification,
      amount: `${Math.floor(request.amountMinor / 100)}.${String(request.amountMinor % 100).padStart(2, '0')}`,
      currency: request.currency,
      status: request.status,
      requesterName: request.requesterName,
      createdAt: request.createdAt,
      decidedByName: request.decidedByName,
      decisionComment: request.decisionComment,
      decidedAt: request.decidedAt,
    }
  }

  private fail(statusCode: number, message: string): never {
    throw new RpcException({ statusCode, message })
  }
}
