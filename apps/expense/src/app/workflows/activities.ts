import type { ExpenseService } from '../expense.service'

export type ApprovalActivities = {
  sendReminder(requestId: string, occurrence: number): Promise<void>
  expireRequest(requestId: string): Promise<void>
}

export function createApprovalActivities(
  expenseService: ExpenseService,
): ApprovalActivities {
  return {
    async sendReminder(requestId: string, occurrence: number) {
      await expenseService.recordReminder(requestId, occurrence)
    },
    async expireRequest(requestId: string) {
      await expenseService.expireRequest(requestId)
    },
  }
}
