const HOUR_MS = 3_600_000

function hoursEnv(name: string, defaultHours: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return defaultHours * HOUR_MS
  const hours = Number(raw)
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new Error(`${name} deve ser um número de horas maior que zero`)
  }
  // Horas fracionárias são permitidas para validação local com timers curtos.
  return Math.round(hours * HOUR_MS)
}

export function decisionTtlMs(): number {
  return hoursEnv('APPROVAL_DECISION_TTL_HOURS', 120)
}

export function reminderDelayMs(): number {
  return hoursEnv('APPROVAL_REMINDER_DELAY_HOURS', 24)
}

export function reminderIntervalMs(): number {
  return hoursEnv('APPROVAL_REMINDER_INTERVAL_HOURS', 24)
}

export function temporalAddress(): string {
  return process.env.TEMPORAL_ADDRESS ?? 'localhost:7233'
}

export function temporalNamespace(): string {
  return process.env.TEMPORAL_NAMESPACE ?? 'default'
}

export function workflowsEnabled(): boolean {
  return process.env.WORKFLOWS_ENABLED !== 'false'
}

export const APPROVAL_TASK_QUEUE = 'approval-lifecycle'

export function approvalWorkflowId(requestId: string): string {
  return `approval-${requestId}`
}
