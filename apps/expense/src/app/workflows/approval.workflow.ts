// Código de workflow Temporal: precisa ser determinístico. Apenas APIs do
// @temporalio/workflow aqui; todo I/O acontece nas activities.
import {
  condition,
  defineSignal,
  proxyActivities,
  setHandler,
} from '@temporalio/workflow'
import type { ApprovalActivities } from './activities'

export type ApprovalWorkflowInput = {
  requestId: string
  decisionDeadlineAt: string
  reminderDelayMs: number
  reminderIntervalMs: number
}

export const decidedSignal = defineSignal('decided')

const { sendReminder, expireRequest } = proxyActivities<ApprovalActivities>({
  startToCloseTimeout: '30 seconds',
  retry: {
    initialInterval: '1 second',
    maximumInterval: '1 minute',
    nonRetryableErrorTypes: ['ApprovalValidationError'],
  },
})

export async function approvalWorkflow(
  input: ApprovalWorkflowInput,
): Promise<void> {
  let decided = false
  setHandler(decidedSignal, () => {
    decided = true
  })

  const deadline = new Date(input.decisionDeadlineAt).getTime()
  let occurrence = 0
  let nextReminderInMs = input.reminderDelayMs

  while (!decided) {
    const untilDeadlineMs = deadline - Date.now()
    if (untilDeadlineMs <= 0) {
      await expireRequest(input.requestId)
      return
    }

    // Um lembrete que cairia no prazo (ou depois) nunca dispara: expira antes.
    const waitMs = Math.min(nextReminderInMs, untilDeadlineMs)
    const decidedInTime = await condition(() => decided, waitMs)
    if (decidedInTime) return

    if (Date.now() >= deadline) {
      await expireRequest(input.requestId)
      return
    }

    occurrence += 1
    await sendReminder(input.requestId, occurrence)
    nextReminderInMs = input.reminderIntervalMs
  }
}
