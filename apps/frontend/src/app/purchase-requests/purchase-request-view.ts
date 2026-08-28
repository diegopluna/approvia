import {
  PurchaseRequestStatus,
  RequestActivity,
} from './purchase-requests.service'

export function statusLabel(status: PurchaseRequestStatus): string {
  return {
    PENDING: 'Pendente',
    APPROVED: 'Aprovada',
    REJECTED: 'Rejeitada',
    EXPIRED: 'Expirada',
  }[status]
}

export function activityLabel(activity: RequestActivity): string {
  if (activity.kind === 'REMINDER_SENT') {
    return `Lembrete ${activity.occurrence ?? 1} enviado aos aprovadores`
  }
  return 'Solicitação expirada automaticamente por falta de decisão'
}

// Extrai a mensagem de um 409 REQUEST_NOT_PENDING do gateway; null para
// qualquer outro erro (o chamador usa a mensagem genérica nesse caso).
export function decisionConflictMessage(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null
  const body = (error as { error?: unknown }).error
  if (typeof body !== 'object' || body === null) return null
  const { code, message } = body as { code?: unknown; message?: unknown }
  if (code !== 'REQUEST_NOT_PENDING' || typeof message !== 'string') {
    return null
  }
  return message
}
