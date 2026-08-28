import { describe, expect, it } from 'vitest'
import {
  activityLabel,
  decisionConflictMessage,
  statusLabel,
} from './purchase-request-view'

describe('statusLabel', () => {
  it('labels every terminal state including expiry', () => {
    expect(statusLabel('PENDING')).toBe('Pendente')
    expect(statusLabel('APPROVED')).toBe('Aprovada')
    expect(statusLabel('REJECTED')).toBe('Rejeitada')
    expect(statusLabel('EXPIRED')).toBe('Expirada')
  })
})

describe('activityLabel', () => {
  it('describes reminder occurrences', () => {
    expect(
      activityLabel({
        kind: 'REMINDER_SENT',
        occurrence: 3,
        occurredAt: '2026-08-27T10:00:00.000Z',
      }),
    ).toBe('Lembrete 3 enviado aos aprovadores')
  })

  it('describes automatic expiry', () => {
    expect(
      activityLabel({
        kind: 'EXPIRED',
        occurrence: null,
        occurredAt: '2026-08-29T10:00:00.000Z',
      }),
    ).toContain('expirada automaticamente')
  })
})

describe('decisionConflictMessage', () => {
  it('extracts the server message from a REQUEST_NOT_PENDING conflict', () => {
    const error = {
      status: 409,
      error: {
        statusCode: 409,
        code: 'REQUEST_NOT_PENDING',
        message: 'A solicitação expirou em 29/08/2026 e não pode mais ser decidida',
      },
    }

    expect(decisionConflictMessage(error)).toContain('expirou em 29/08/2026')
  })

  it('returns null for other errors so the generic message is used', () => {
    expect(decisionConflictMessage({ status: 500, error: 'boom' })).toBeNull()
    expect(
      decisionConflictMessage({
        status: 409,
        error: { statusCode: 409, message: 'outro conflito' },
      }),
    ).toBeNull()
    expect(decisionConflictMessage(undefined)).toBeNull()
  })
})
