import { describe, expect, it } from 'vitest'
import { EXPENSE_EVENT_NAMES, parseExpenseIntegrationEvent } from './index'

const createdEvent = {
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

describe('parseExpenseIntegrationEvent', () => {
  it('parses a valid created event', () => {
    expect(parseExpenseIntegrationEvent(createdEvent)).toEqual(createdEvent)
  })

  it('rejects an invalid requester email', () => {
    expect(() =>
      parseExpenseIntegrationEvent({
        ...createdEvent,
        data: {
          request: { ...createdEvent.data.request, requesterEmail: 'invalid' },
        },
      }),
    ).toThrow('Requester email is invalid')
  })

  it('rejects mismatched decision event data', () => {
    expect(() =>
      parseExpenseIntegrationEvent({
        ...createdEvent,
        eventName: EXPENSE_EVENT_NAMES.approved,
        data: {
          ...createdEvent.data,
          decision: {
            status: 'REJECTED',
            decidedByName: 'Approver',
            comment: 'Not approved',
            decidedAt: '2026-07-30T11:00:00.000Z',
          },
        },
      }),
    ).toThrow('Event name and decision status do not match')
  })
})
