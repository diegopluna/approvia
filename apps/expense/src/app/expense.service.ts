import { Inject, Injectable } from '@nestjs/common'
import { RpcException } from '@nestjs/microservices'
import {
  Prisma,
  PurchaseRequest,
  PurchaseRequestStatus,
} from '../generated/prisma/client'
import { PrismaService } from './prisma.service'

export type ExpenseUser = {
  id: string
  name: string
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
    const data = {
      title: input.title.trim(),
      justification: input.justification.trim(),
      amountMinor,
      requesterId: user.id,
      requesterName: user.name,
      idempotencyKey: key,
    }

    try {
      const request = await this.prisma.purchaseRequest.create({ data })
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

  async decide(
    user: ExpenseUser,
    id: string,
    input: DecideExpenseRequest,
  ) {
    const request = await this.prisma.purchaseRequest.findUnique({
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

    const result = await this.prisma.purchaseRequest.updateMany({
      where: { id, status: PurchaseRequestStatus.PENDING },
      data: {
        status: input.decision,
        decidedById: user.id,
        decidedByName: user.name,
        decisionComment: comment,
        decidedAt: new Date(),
      },
    })

    if (result.count === 0) {
      const current = await this.prisma.purchaseRequest.findUniqueOrThrow({
        where: { id },
      })
      return this.decisionReplay(current, user, input)
    }

    const decidedRequest = await this.prisma.purchaseRequest.findUniqueOrThrow({
      where: { id },
    })
    return this.toResponse(decidedRequest)
  }

  // Sob entrega at-least-once, repetir a mesma decisão do mesmo aprovador
  // (reentrega ou retentativa após timeout) devolve o resultado original em
  // vez de 409; decisão diferente ou de outro aprovador continua conflitando.
  private decisionReplay(
    request: PurchaseRequest,
    user: ExpenseUser,
    input: DecideExpenseRequest,
  ) {
    if (request.decidedById === user.id && request.status === input.decision) {
      return this.toResponse(request)
    }
    this.fail(409, 'A solicitação já foi decidida')
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
