import { Inject, Injectable } from '@nestjs/common'
import { RpcException } from '@nestjs/microservices'
import {
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

  async create(user: ExpenseUser, input: CreateExpenseRequest) {
    const amountMinor = this.toMinorUnits(input.amount)
    if (amountMinor === 0) {
      this.fail(400, 'O valor deve ser maior que zero')
    }

    const request = await this.prisma.purchaseRequest.create({
      data: {
        title: input.title.trim(),
        justification: input.justification.trim(),
        amountMinor,
        requesterId: user.id,
        requesterName: user.name,
      },
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
      this.fail(409, 'A solicitação já foi decidida')
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

    if (result.count === 0) this.fail(409, 'A solicitação já foi decidida')

    const decidedRequest = await this.prisma.purchaseRequest.findUniqueOrThrow({
      where: { id },
    })
    return this.toResponse(decidedRequest)
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
