import { afterEach, describe, expect, it, vi } from 'vitest'
import { EXPENSE_EVENT_NAMES, ExpenseIntegrationEvent } from '@approvia/events'
import { EmailDeliveryStatus } from '../generated/prisma/client'
import { EmailDeliveryService } from './email-delivery.service'
import { EmailProvider } from './email.provider'
import { EmailTemplateService } from './email-template.service'
import { KeycloakRecipientService } from './keycloak-recipient.service'

const event: ExpenseIntegrationEvent = {
  eventId: '3af83c96-dff0-4bed-8b1c-5d2d985d13cd',
  eventName: EXPENSE_EVENT_NAMES.created,
  occurredAt: '2026-07-30T10:00:00.000Z',
  aggregateId: '3262e98f-8071-4532-a8f2-620d7b2fac3f',
  correlationId: '3af83c96-dff0-4bed-8b1c-5d2d985d13cd',
  data: {
    request: {
      id: '3262e98f-8071-4532-a8f2-620d7b2fac3f',
      title: 'Monitor',
      amountMinor: 149990,
      currency: 'BRL',
      requesterId: 'requester-id',
      requesterName: 'Test User',
      requesterEmail: 'test@approvia.dev',
      createdAt: '2026-07-30T10:00:00.000Z',
    },
  },
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('EmailTemplateService', () => {
  it('renders the created request template in BRL', () => {
    const rendered = new EmailTemplateService().render(event)

    expect(rendered.template).toBe('expense-request-created')
    expect(rendered.text).toContain('R$ 1.499,90')
    expect(rendered.html).toContain('Nova solicitação')
  })

  it('renders the rejection decision and comment', () => {
    const rejected: ExpenseIntegrationEvent = {
      ...event,
      eventName: EXPENSE_EVENT_NAMES.rejected,
      data: {
        ...event.data,
        decision: {
          status: 'REJECTED',
          decidedByName: 'Alex Approver',
          comment: 'Budget unavailable',
          decidedAt: '2026-07-30T11:00:00.000Z',
        },
      },
    }

    const rendered = new EmailTemplateService().render(rejected)

    expect(rendered.template).toBe('expense-request-rejected')
    expect(rendered.text).toContain('Budget unavailable')
  })
})

describe('EmailDeliveryService', () => {
  it('persists and sends with a stable idempotency key', async () => {
    const provider: EmailProvider = {
      send: vi.fn().mockResolvedValue('provider-message-id'),
    }
    const prisma = {
      emailDelivery: {
        upsert: vi.fn().mockResolvedValue({
          id: 'delivery-id',
          status: EmailDeliveryStatus.PENDING,
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue(undefined),
      },
    }
    const service = new EmailDeliveryService(
      prisma as never,
      new EmailTemplateService(),
      provider,
    )

    await service.deliver(event, 'APPROVER@APPROVIA.DEV')

    expect(provider.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'approver@approvia.dev',
        idempotencyKey:
          '3af83c96-dff0-4bed-8b1c-5d2d985d13cd:approver@approvia.dev:expense-request-created:v1',
      }),
    )
    expect(prisma.emailDelivery.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: EmailDeliveryStatus.SENT }),
      }),
    )
  })

  it('does not resend an already delivered email', async () => {
    const provider: EmailProvider = { send: vi.fn() }
    const prisma = {
      emailDelivery: {
        upsert: vi.fn().mockResolvedValue({
          id: 'delivery-id',
          status: EmailDeliveryStatus.SENT,
        }),
        updateMany: vi.fn(),
        update: vi.fn(),
      },
    }
    const service = new EmailDeliveryService(
      prisma as never,
      new EmailTemplateService(),
      provider,
    )

    await service.deliver(event, 'approver@approvia.dev')

    expect(provider.send).not.toHaveBeenCalled()
    expect(prisma.emailDelivery.updateMany).not.toHaveBeenCalled()
    expect(prisma.emailDelivery.update).not.toHaveBeenCalled()
  })
})

describe('KeycloakRecipientService', () => {
  it('resolves and caches enabled approvers with email', async () => {
    vi.stubEnv('KEYCLOAK_NOTIFICATIONS_CLIENT_SECRET', 'secret')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'token' }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              enabled: true,
              email: 'approver@approvia.dev',
              firstName: 'Alex',
              lastName: 'Approver',
            },
            { enabled: false, email: 'disabled@approvia.dev' },
          ]),
          { status: 200 },
        ),
      )
    vi.stubGlobal('fetch', fetchMock)
    const service = new KeycloakRecipientService()

    await expect(service.approvers()).resolves.toEqual([
      { email: 'approver@approvia.dev', name: 'Alex Approver' },
    ])
    await service.approvers()

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
