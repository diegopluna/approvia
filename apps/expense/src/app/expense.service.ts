import { Inject, Injectable } from '@nestjs/common'
import { RpcException } from '@nestjs/microservices'
import {
  deterministicEventId,
  EXPENSE_EVENT_NAMES,
  ExpenseIntegrationEvent,
  ExpenseRequestSnapshot,
} from '@approvia/events'
import { randomUUID } from 'node:crypto'
import {
  Prisma,
  PurchaseRequest,
  PurchaseRequestStatus,
  RequestActivity,
  RequestActivityKind,
} from '../generated/prisma/client'
import { PrismaService } from './prisma.service'
import { decisionTtlMs } from './workflows/workflow.config'

type PurchaseRequestWithActivities = PurchaseRequest & {
  activities?: RequestActivity[]
}

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

  async create(
    user: ExpenseUser,
    input: CreateExpenseRequest,
    idempotencyKey?: string,
  ) {
    const amountMinor = this.toMinorUnits(input.amount)
    if (amountMinor === 0) {
      this.fail(400, 'O valor deve ser maior que zero')
    }

    const key = idempotencyKey?.trim() || null
    const now = new Date()
    const data = {
      title: input.title.trim(),
      justification: input.justification.trim(),
      amountMinor,
      requesterId: user.id,
      requesterName: user.name,
      requesterEmail: user.email,
      idempotencyKey: key,
      createdAt: now,
      decisionDeadlineAt: new Date(now.getTime() + decisionTtlMs()),
    }

    try {
      const request = await this.prisma.$transaction(async (transaction) => {
        const created = await transaction.purchaseRequest.create({ data })
        await this.writeOutboxEvent(
          transaction,
          this.createdEvent(created, randomUUID()),
        )
        return created
      })
      return this.toResponse(request)
    } catch (error) {
      if (key && this.isIdempotencyConflict(error)) {
        return this.replay(user.id, key, data)
      }
      throw error
    }
  }

  private isIdempotencyConflict(error: unknown): boolean {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== 'P2002'
    ) {
      return false
    }
    // O target pode vir como campos do client ou nome do índice, conforme o
    // adapter; sem target, a única unique além da PK é a de idempotência.
    const target = (error.meta as { target?: unknown } | undefined)?.target
    return target === undefined || /idempotenc/i.test(JSON.stringify(target))
  }

  private async replay(
    requesterId: string,
    idempotencyKey: string,
    attempted: {
      title: string
      justification: string
      amountMinor: number
    },
  ) {
    const existing = await this.prisma.purchaseRequest.findUniqueOrThrow({
      where: {
        requesterId_idempotencyKey: { requesterId, idempotencyKey },
      },
    })

    if (
      existing.title !== attempted.title ||
      existing.justification !== attempted.justification ||
      existing.amountMinor !== attempted.amountMinor
    ) {
      this.fail(
        409,
        'A chave de idempotência já foi usada com dados diferentes',
      )
    }

    return this.toResponse(existing)
  }

  async mine(user: ExpenseUser) {
    const requests = await this.prisma.purchaseRequest.findMany({
      where: { requesterId: user.id },
      orderBy: { createdAt: 'desc' },
      include: { activities: { orderBy: { occurredAt: 'asc' } } },
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
          return this.decisionReplay(request, user, input)
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

        if (result.count === 0) {
          const current = await transaction.purchaseRequest.findUniqueOrThrow({
            where: { id },
          })
          return this.decisionReplay(current, user, input)
        }

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

  // Comando idempotente disparado pela activity de lembrete: efeito no máximo
  // uma vez por ocorrência, garantido pela unique (requestId, kind, occurrence)
  // e pelo eventId determinístico que colide com o dedupe das entregas.
  async recordReminder(requestId: string, occurrence: number) {
    await this.prisma.$transaction(async (transaction) => {
      const request = await transaction.purchaseRequest.findUnique({
        where: { id: requestId },
      })
      if (
        !request ||
        request.status !== PurchaseRequestStatus.PENDING ||
        !request.decisionDeadlineAt
      ) {
        return
      }

      const existing = await transaction.requestActivity.findUnique({
        where: {
          requestId_kind_occurrence: {
            requestId,
            kind: RequestActivityKind.REMINDER_SENT,
            occurrence,
          },
        },
      })
      if (existing) return

      await transaction.requestActivity.create({
        data: {
          requestId,
          kind: RequestActivityKind.REMINDER_SENT,
          occurrence,
        },
      })

      if (!request.requesterEmail) {
        // Solicitações geridas pelo workflow sempre têm email; guarda
        // defensiva para não derrubar a activity com um snapshot inválido.
        return
      }
      await this.writeOutboxEvent(
        transaction,
        this.reminderEvent(request, occurrence, request.decisionDeadlineAt),
      )
    })
  }

  // Transição PENDING → EXPIRED disparada pelo workflow no prazo: a decisão
  // registrada primeiro sempre vence (updateMany condicional, 0 linhas = no-op).
  async expireRequest(requestId: string) {
    await this.prisma.$transaction(async (transaction) => {
      const expiredAt = new Date()
      const result = await transaction.purchaseRequest.updateMany({
        where: { id: requestId, status: PurchaseRequestStatus.PENDING },
        data: { status: PurchaseRequestStatus.EXPIRED, expiredAt },
      })
      if (result.count === 0) return

      await transaction.requestActivity.create({
        data: { requestId, kind: RequestActivityKind.EXPIRED },
      })

      const request = await transaction.purchaseRequest.findUniqueOrThrow({
        where: { id: requestId },
      })
      if (!request.requesterEmail) return
      await this.writeOutboxEvent(
        transaction,
        this.expiredEvent(
          request,
          request.decisionDeadlineAt ?? expiredAt,
          expiredAt,
        ),
      )
    })
  }

  private reminderEvent(
    request: PurchaseRequest,
    occurrence: number,
    decisionDeadlineAt: Date,
  ): ExpenseIntegrationEvent {
    const eventId = deterministicEventId(
      `${request.id}:reminder:${occurrence}`,
    )
    return {
      eventId,
      eventName: EXPENSE_EVENT_NAMES.reminder,
      aggregateId: request.id,
      correlationId: eventId,
      occurredAt: new Date().toISOString(),
      data: {
        request: this.eventSnapshot(request),
        reminder: {
          occurrence,
          decisionDeadlineAt: decisionDeadlineAt.toISOString(),
        },
      },
    }
  }

  private expiredEvent(
    request: PurchaseRequest,
    decisionDeadlineAt: Date,
    expiredAt: Date,
  ): ExpenseIntegrationEvent {
    const eventId = deterministicEventId(`${request.id}:expired`)
    return {
      eventId,
      eventName: EXPENSE_EVENT_NAMES.expired,
      aggregateId: request.id,
      correlationId: eventId,
      occurredAt: expiredAt.toISOString(),
      data: {
        request: this.eventSnapshot(request),
        expiry: {
          decisionDeadlineAt: decisionDeadlineAt.toISOString(),
          expiredAt: expiredAt.toISOString(),
        },
      },
    }
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
      ...(request.decisionDeadlineAt
        ? { decisionDeadlineAt: request.decisionDeadlineAt.toISOString() }
        : {}),
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

  // Sob entrega at-least-once, repetir a mesma decisão do mesmo aprovador
  // (reentrega ou retentativa após timeout) devolve o resultado original em
  // vez de 409; decisão diferente ou de outro aprovador continua conflitando.
  private decisionReplay(
    request: PurchaseRequest,
    user: ExpenseUser,
    input: DecideExpenseRequest,
  ): PurchaseRequest {
    if (request.status === PurchaseRequestStatus.EXPIRED) {
      const expiredOn = (request.expiredAt ?? new Date()).toLocaleDateString(
        'pt-BR',
      )
      this.fail(
        409,
        `A solicitação expirou em ${expiredOn} e não pode mais ser decidida`,
        'REQUEST_NOT_PENDING',
      )
    }
    if (request.decidedById === user.id && request.status === input.decision) {
      return request
    }
    this.fail(
      409,
      'A solicitação já foi aprovada ou rejeitada',
      'REQUEST_NOT_PENDING',
    )
  }

  private toMinorUnits(amount: string): number {
    const [whole, decimal = ''] = amount.split('.')
    return Number(whole) * 100 + Number(decimal.padEnd(2, '0'))
  }

  private toResponse(request: PurchaseRequestWithActivities) {
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
      decisionDeadlineAt: request.decisionDeadlineAt ?? null,
      expiredAt: request.expiredAt ?? null,
      activities: (request.activities ?? []).map((activity) => ({
        kind: activity.kind,
        occurrence: activity.occurrence,
        occurredAt: activity.occurredAt,
      })),
    }
  }

  private fail(statusCode: number, message: string, code?: string): never {
    throw new RpcException({ statusCode, message, ...(code ? { code } : {}) })
  }
}
