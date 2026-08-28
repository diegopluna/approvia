import { deterministicEventId, EXPENSE_EVENT_NAMES } from '@approvia/events'
import { RpcException } from '@nestjs/microservices'
import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PurchaseRequest,
  PurchaseRequestStatus,
  RequestActivity,
  RequestActivityKind,
} from '../generated/prisma/client'
import { ExpenseService } from './expense.service'
import { PrismaService } from './prisma.service'

type Store = {
  requests: PurchaseRequest[]
  activities: RequestActivity[]
  outbox: { id: string; eventName: string; payload: unknown }[]
}

function fakePrisma(store: Store) {
  const prisma = {
    purchaseRequest: {
      findUnique: vi.fn(({ where }: { where: { id: string } }) =>
        store.requests.find((request) => request.id === where.id) ?? null,
      ),
      findUniqueOrThrow: vi.fn(({ where }: { where: { id: string } }) => {
        const request = store.requests.find((item) => item.id === where.id)
        if (!request) throw new Error('Not found')
        return request
      }),
      updateMany: vi.fn(
        ({
          where,
          data,
        }: {
          where: { id: string; status: PurchaseRequestStatus }
          data: Partial<PurchaseRequest>
        }) => {
          const request = store.requests.find(
            (item) => item.id === where.id && item.status === where.status,
          )
          if (!request) return { count: 0 }
          Object.assign(request, data)
          return { count: 1 }
        },
      ),
    },
    requestActivity: {
      findUnique: vi.fn(
        ({
          where,
        }: {
          where: {
            requestId_kind_occurrence: {
              requestId: string
              kind: RequestActivityKind
              occurrence: number
            }
          }
        }) => {
          const key = where.requestId_kind_occurrence
          return (
            store.activities.find(
              (activity) =>
                activity.requestId === key.requestId &&
                activity.kind === key.kind &&
                activity.occurrence === key.occurrence,
            ) ?? null
          )
        },
      ),
      create: vi.fn(({ data }: { data: Partial<RequestActivity> }) => {
        const activity = {
          id: randomUUID(),
          requestId: data.requestId ?? '',
          kind: data.kind ?? RequestActivityKind.REMINDER_SENT,
          occurrence: data.occurrence ?? null,
          details: null,
          occurredAt: new Date(),
        }
        store.activities.push(activity)
        return activity
      }),
    },
    outboxEvent: {
      create: vi.fn(
        ({
          data,
        }: {
          data: { id: string; eventName: string; payload: unknown }
        }) => {
          store.outbox.push(data)
          return data
        },
      ),
    },
    $transaction: vi.fn(
      (callback: (transaction: unknown) => unknown) => callback(prisma),
    ),
  }
  return prisma
}

function pendingRequest(overrides: Partial<PurchaseRequest> = {}): PurchaseRequest {
  const createdAt = new Date('2026-08-24T10:00:00.000Z')
  return {
    id: randomUUID(),
    title: 'Monitor',
    justification: 'Trabalho remoto',
    amountMinor: 149990,
    currency: 'BRL',
    status: PurchaseRequestStatus.PENDING,
    requesterId: 'requester-id',
    requesterName: 'Test User',
    requesterEmail: 'test@approvia.dev',
    createdAt,
    decidedById: null,
    decidedByName: null,
    decisionComment: null,
    decidedAt: null,
    idempotencyKey: null,
    decisionDeadlineAt: new Date(createdAt.getTime() + 120 * 3_600_000),
    expiredAt: null,
    ...overrides,
  }
}

describe('ExpenseService.recordReminder', () => {
  let store: Store
  let service: ExpenseService

  beforeEach(() => {
    store = { requests: [], activities: [], outbox: [] }
    service = new ExpenseService(
      fakePrisma(store) as unknown as PrismaService,
    )
  })

  it('records the occurrence and writes a deterministic outbox event in one pass', async () => {
    const request = pendingRequest()
    store.requests.push(request)

    await service.recordReminder(request.id, 1)

    expect(store.activities).toHaveLength(1)
    expect(store.activities[0]).toMatchObject({
      requestId: request.id,
      kind: RequestActivityKind.REMINDER_SENT,
      occurrence: 1,
    })
    expect(store.outbox).toHaveLength(1)
    expect(store.outbox[0].id).toBe(
      deterministicEventId(`${request.id}:reminder:1`),
    )
    expect(store.outbox[0].eventName).toBe(EXPENSE_EVENT_NAMES.reminder)
    const payload = store.outbox[0].payload as {
      eventId: string
      data: { reminder: { occurrence: number; decisionDeadlineAt: string } }
    }
    expect(payload.eventId).toBe(store.outbox[0].id)
    expect(payload.data.reminder.occurrence).toBe(1)
    expect(payload.data.reminder.decisionDeadlineAt).toBe(
      request.decisionDeadlineAt?.toISOString(),
    )
  })

  it('is a no-op for a duplicate occurrence', async () => {
    const request = pendingRequest()
    store.requests.push(request)

    await service.recordReminder(request.id, 1)
    await service.recordReminder(request.id, 1)

    expect(store.activities).toHaveLength(1)
    expect(store.outbox).toHaveLength(1)
  })

  it('is a no-op when the request is no longer pending', async () => {
    const request = pendingRequest({
      status: PurchaseRequestStatus.APPROVED,
    })
    store.requests.push(request)

    await service.recordReminder(request.id, 1)

    expect(store.activities).toHaveLength(0)
    expect(store.outbox).toHaveLength(0)
  })

  it('records history but skips the event when requesterEmail is missing', async () => {
    const request = pendingRequest({ requesterEmail: null })
    store.requests.push(request)

    await service.recordReminder(request.id, 1)

    expect(store.activities).toHaveLength(1)
    expect(store.outbox).toHaveLength(0)
  })
})

describe('ExpenseService.expireRequest', () => {
  let store: Store
  let service: ExpenseService

  beforeEach(() => {
    store = { requests: [], activities: [], outbox: [] }
    service = new ExpenseService(
      fakePrisma(store) as unknown as PrismaService,
    )
  })

  it('expires a pending request with history and a deterministic expired event', async () => {
    const request = pendingRequest()
    store.requests.push(request)

    await service.expireRequest(request.id)

    expect(request.status).toBe(PurchaseRequestStatus.EXPIRED)
    expect(request.expiredAt).toBeInstanceOf(Date)
    expect(store.activities).toHaveLength(1)
    expect(store.activities[0].kind).toBe(RequestActivityKind.EXPIRED)
    expect(store.outbox).toHaveLength(1)
    expect(store.outbox[0].id).toBe(deterministicEventId(`${request.id}:expired`))
    expect(store.outbox[0].eventName).toBe(EXPENSE_EVENT_NAMES.expired)
  })

  it('is a no-op when a decision already won the race', async () => {
    const request = pendingRequest({
      status: PurchaseRequestStatus.APPROVED,
      decidedById: 'approver-id',
    })
    store.requests.push(request)

    await service.expireRequest(request.id)

    expect(request.status).toBe(PurchaseRequestStatus.APPROVED)
    expect(store.activities).toHaveLength(0)
    expect(store.outbox).toHaveLength(0)
  })

  it('expires only once under repeated calls', async () => {
    const request = pendingRequest()
    store.requests.push(request)

    await service.expireRequest(request.id)
    await service.expireRequest(request.id)

    expect(store.activities).toHaveLength(1)
    expect(store.outbox).toHaveLength(1)
  })
})

describe('ExpenseService.decide guards', () => {
  let store: Store
  let service: ExpenseService
  const approver = {
    id: 'approver-id',
    name: 'Alex Approver',
    email: 'approver@approvia.dev',
  }

  beforeEach(() => {
    store = { requests: [], activities: [], outbox: [] }
    service = new ExpenseService(
      fakePrisma(store) as unknown as PrismaService,
    )
  })

  it('refuses a decision on an expired request with REQUEST_NOT_PENDING', async () => {
    const request = pendingRequest({
      status: PurchaseRequestStatus.EXPIRED,
      expiredAt: new Date('2026-08-29T10:00:00.000Z'),
    })
    store.requests.push(request)

    const attempt = service.decide(approver, request.id, {
      decision: 'APPROVED',
    })

    await expect(attempt).rejects.toBeInstanceOf(RpcException)
    await attempt.catch((error: RpcException) => {
      expect(error.getError()).toMatchObject({
        statusCode: 409,
        code: 'REQUEST_NOT_PENDING',
      })
      expect(String((error.getError() as { message: string }).message)).toContain(
        'expirou',
      )
    })
    expect(request.status).toBe(PurchaseRequestStatus.EXPIRED)
  })

  it('refuses a conflicting decision on an already decided request', async () => {
    const request = pendingRequest({
      status: PurchaseRequestStatus.REJECTED,
      decidedById: 'someone-else',
    })
    store.requests.push(request)

    await expect(
      service.decide(approver, request.id, { decision: 'APPROVED' }),
    ).rejects.toBeInstanceOf(RpcException)
  })
})
