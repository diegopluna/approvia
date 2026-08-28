import { v5 as uuidv5 } from 'uuid'

export const EXPENSE_EVENT_NAMES = {
  created: 'expense.request.created.v1',
  approved: 'expense.request.approved.v1',
  rejected: 'expense.request.rejected.v1',
  reminder: 'expense.request.reminder.v1',
  expired: 'expense.request.expired.v1',
} as const

// Namespace fixo para ids determinísticos: a mesma semente (ex.:
// "<requestId>:reminder:1") sempre gera o mesmo eventId, permitindo dedupe
// fim a fim nas entregas de email mesmo sob retentativas do produtor.
const EVENT_ID_NAMESPACE = 'aa63a5b3-8f5b-4f7e-9f3a-2d1c67e0a9d4'

export function deterministicEventId(seed: string): string {
  return uuidv5(seed, EVENT_ID_NAMESPACE)
}

export const APPLICATION_EVENTS_EXCHANGE = 'approvia.events'

export type ExpenseEventName =
  (typeof EXPENSE_EVENT_NAMES)[keyof typeof EXPENSE_EVENT_NAMES]

export type ExpenseRequestSnapshot = {
  id: string
  title: string
  amountMinor: number
  currency: string
  requesterId: string
  requesterName: string
  requesterEmail: string
  createdAt: string
  // Opcional para compatibilidade com eventos anteriores ao prazo de decisão.
  decisionDeadlineAt?: string | null
}

export type ExpenseRequestCreatedEvent = {
  eventId: string
  eventName: typeof EXPENSE_EVENT_NAMES.created
  occurredAt: string
  aggregateId: string
  correlationId: string
  data: {
    request: ExpenseRequestSnapshot
  }
}

export type ExpenseRequestDecidedEvent = {
  eventId: string
  eventName:
    | typeof EXPENSE_EVENT_NAMES.approved
    | typeof EXPENSE_EVENT_NAMES.rejected
  occurredAt: string
  aggregateId: string
  correlationId: string
  data: {
    request: ExpenseRequestSnapshot
    decision: {
      status: 'APPROVED' | 'REJECTED'
      decidedByName: string
      comment: string | null
      decidedAt: string
    }
  }
}

export type ExpenseRequestReminderEvent = {
  eventId: string
  eventName: typeof EXPENSE_EVENT_NAMES.reminder
  occurredAt: string
  aggregateId: string
  correlationId: string
  data: {
    request: ExpenseRequestSnapshot
    reminder: {
      occurrence: number
      decisionDeadlineAt: string
    }
  }
}

export type ExpenseRequestExpiredEvent = {
  eventId: string
  eventName: typeof EXPENSE_EVENT_NAMES.expired
  occurredAt: string
  aggregateId: string
  correlationId: string
  data: {
    request: ExpenseRequestSnapshot
    expiry: {
      decisionDeadlineAt: string
      expiredAt: string
    }
  }
}

export type ExpenseIntegrationEvent =
  | ExpenseRequestCreatedEvent
  | ExpenseRequestDecidedEvent
  | ExpenseRequestReminderEvent
  | ExpenseRequestExpiredEvent

export function parseExpenseIntegrationEvent(
  value: unknown,
): ExpenseIntegrationEvent {
  if (!isRecord(value)) throw new Error('Event must be an object')

  const eventName = requiredString(value, 'eventName')
  if (
    !Object.values(EXPENSE_EVENT_NAMES).includes(eventName as ExpenseEventName)
  ) {
    throw new Error(`Unsupported event name: ${eventName}`)
  }

  const data = requiredRecord(value, 'data')
  const request = parseRequest(requiredRecord(data, 'request'))
  const base = {
    eventId: requiredString(value, 'eventId'),
    eventName: eventName as ExpenseEventName,
    occurredAt: requiredDate(value, 'occurredAt'),
    aggregateId: requiredString(value, 'aggregateId'),
    correlationId: requiredString(value, 'correlationId'),
  }

  if (eventName === EXPENSE_EVENT_NAMES.created) {
    return { ...base, eventName, data: { request } }
  }

  if (eventName === EXPENSE_EVENT_NAMES.reminder) {
    const reminder = requiredRecord(data, 'reminder')
    const occurrence = reminder['occurrence']
    if (!Number.isInteger(occurrence) || (occurrence as number) < 1) {
      throw new Error('Reminder occurrence is invalid')
    }
    return {
      ...base,
      eventName,
      data: {
        request,
        reminder: {
          occurrence: occurrence as number,
          decisionDeadlineAt: requiredDate(reminder, 'decisionDeadlineAt'),
        },
      },
    }
  }

  if (eventName === EXPENSE_EVENT_NAMES.expired) {
    const expiry = requiredRecord(data, 'expiry')
    return {
      ...base,
      eventName,
      data: {
        request,
        expiry: {
          decisionDeadlineAt: requiredDate(expiry, 'decisionDeadlineAt'),
          expiredAt: requiredDate(expiry, 'expiredAt'),
        },
      },
    }
  }

  if (
    eventName !== EXPENSE_EVENT_NAMES.approved &&
    eventName !== EXPENSE_EVENT_NAMES.rejected
  ) {
    throw new Error(`Unsupported event name: ${eventName}`)
  }

  const decision = requiredRecord(data, 'decision')
  const status = requiredString(decision, 'status')
  if (status !== 'APPROVED' && status !== 'REJECTED') {
    throw new Error('Decision status is invalid')
  }
  if (
    (eventName === EXPENSE_EVENT_NAMES.approved && status !== 'APPROVED') ||
    (eventName === EXPENSE_EVENT_NAMES.rejected && status !== 'REJECTED')
  ) {
    throw new Error('Event name and decision status do not match')
  }

  return {
    ...base,
    eventName,
    data: {
      request,
      decision: {
        status,
        decidedByName: requiredString(decision, 'decidedByName'),
        comment: optionalString(decision, 'comment'),
        decidedAt: requiredDate(decision, 'decidedAt'),
      },
    },
  }
}

function parseRequest(value: Record<string, unknown>): ExpenseRequestSnapshot {
  const amountMinor = value['amountMinor']
  if (!Number.isInteger(amountMinor) || (amountMinor as number) < 0) {
    throw new Error('Request amountMinor is invalid')
  }

  const requesterEmail = requiredString(value, 'requesterEmail')
  if (!requesterEmail.includes('@'))
    throw new Error('Requester email is invalid')

  const decisionDeadlineAt = optionalString(value, 'decisionDeadlineAt')
  if (
    decisionDeadlineAt !== null &&
    Number.isNaN(Date.parse(decisionDeadlineAt))
  ) {
    throw new Error('decisionDeadlineAt is invalid')
  }

  return {
    id: requiredString(value, 'id'),
    title: requiredString(value, 'title'),
    amountMinor: amountMinor as number,
    currency: requiredString(value, 'currency'),
    requesterId: requiredString(value, 'requesterId'),
    requesterName: requiredString(value, 'requesterName'),
    requesterEmail,
    createdAt: requiredDate(value, 'createdAt'),
    ...(decisionDeadlineAt !== null ? { decisionDeadlineAt } : {}),
  }
}

function requiredDate(value: Record<string, unknown>, key: string): string {
  const result = requiredString(value, key)
  if (Number.isNaN(Date.parse(result))) throw new Error(`${key} is invalid`)
  return result
}

function requiredString(value: Record<string, unknown>, key: string): string {
  const result = value[key]
  if (typeof result !== 'string' || !result) {
    throw new Error(`${key} is required`)
  }
  return result
}

function optionalString(
  value: Record<string, unknown>,
  key: string,
): string | null {
  const result = value[key]
  if (result === null || result === undefined) return null
  if (typeof result !== 'string') throw new Error(`${key} is invalid`)
  return result
}

function requiredRecord(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const result = value[key]
  if (!isRecord(result)) throw new Error(`${key} is required`)
  return result
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
