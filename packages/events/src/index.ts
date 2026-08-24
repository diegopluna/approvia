export const EXPENSE_EVENT_NAMES = {
  created: 'expense.request.created.v1',
  approved: 'expense.request.approved.v1',
  rejected: 'expense.request.rejected.v1',
} as const

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

export type ExpenseIntegrationEvent =
  | ExpenseRequestCreatedEvent
  | ExpenseRequestDecidedEvent

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

  return {
    id: requiredString(value, 'id'),
    title: requiredString(value, 'title'),
    amountMinor: amountMinor as number,
    currency: requiredString(value, 'currency'),
    requesterId: requiredString(value, 'requesterId'),
    requesterName: requiredString(value, 'requesterName'),
    requesterEmail,
    createdAt: requiredDate(value, 'createdAt'),
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
