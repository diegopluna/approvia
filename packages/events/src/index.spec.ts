import { describe, expect, it } from 'vitest'
import {
  deterministicEventId,
  EXPENSE_EVENT_NAMES,
  parseExpenseIntegrationEvent,
} from './index'

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

  it('parses a valid reminder event', () => {
    const reminderEvent = {
      ...createdEvent,
      eventName: EXPENSE_EVENT_NAMES.reminder,
      data: {
        ...createdEvent.data,
        reminder: {
          occurrence: 2,
          decisionDeadlineAt: '2026-08-04T10:00:00.000Z',
        },
      },
    }

    expect(parseExpenseIntegrationEvent(reminderEvent)).toEqual(reminderEvent)
  })

  it('rejects a reminder event without a valid occurrence', () => {
    expect(() =>
      parseExpenseIntegrationEvent({
        ...createdEvent,
        eventName: EXPENSE_EVENT_NAMES.reminder,
        data: {
          ...createdEvent.data,
          reminder: {
            occurrence: 0,
            decisionDeadlineAt: '2026-08-04T10:00:00.000Z',
          },
        },
      }),
    ).toThrow('Reminder occurrence is invalid')
  })

  it('parses a valid expired event', () => {
    const expiredEvent = {
      ...createdEvent,
      eventName: EXPENSE_EVENT_NAMES.expired,
      data: {
        ...createdEvent.data,
        expiry: {
          decisionDeadlineAt: '2026-08-04T10:00:00.000Z',
          expiredAt: '2026-08-04T10:00:03.000Z',
        },
      },
    }

    expect(parseExpenseIntegrationEvent(expiredEvent)).toEqual(expiredEvent)
  })

  it('rejects an expired event with an invalid deadline', () => {
    expect(() =>
      parseExpenseIntegrationEvent({
        ...createdEvent,
        eventName: EXPENSE_EVENT_NAMES.expired,
        data: {
          ...createdEvent.data,
          expiry: { decisionDeadlineAt: 'not-a-date', expiredAt: 'also-not' },
        },
      }),
    ).toThrow('decisionDeadlineAt is invalid')
  })
})

describe('deterministicEventId', () => {
  it('is stable for the same seed and distinct across seeds', () => {
    const requestId = '3262e98f-8071-4532-a8f2-620d7b2fac3f'
    const first = deterministicEventId(`${requestId}:reminder:1`)

    expect(first).toBe(deterministicEventId(`${requestId}:reminder:1`))
    expect(first).not.toBe(deterministicEventId(`${requestId}:reminder:2`))
    expect(first).not.toBe(deterministicEventId(`${requestId}:expired`))
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })
})
