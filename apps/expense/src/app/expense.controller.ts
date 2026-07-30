import { Controller, Inject } from '@nestjs/common'
import { MessagePattern, Payload } from '@nestjs/microservices'
import {
  CreateExpenseRequest,
  DecideExpenseRequest,
  ExpenseService,
  ExpenseUser,
} from './expense.service'

@Controller()
export class ExpenseController {
  constructor(
    @Inject(ExpenseService) private readonly expenseService: ExpenseService,
  ) {}

  @MessagePattern({ cmd: 'expense.create' })
  create(
    @Payload()
    payload: { user: ExpenseUser; input: CreateExpenseRequest },
  ) {
    return this.expenseService.create(payload.user, payload.input)
  }

  @MessagePattern({ cmd: 'expense.mine' })
  mine(@Payload() payload: { user: ExpenseUser }) {
    return this.expenseService.mine(payload.user)
  }

  @MessagePattern({ cmd: 'expense.pending' })
  pending(@Payload() payload: { user: ExpenseUser }) {
    return this.expenseService.pending(payload.user)
  }

  @MessagePattern({ cmd: 'expense.approved' })
  approved(@Payload() payload: { user: ExpenseUser }) {
    return this.expenseService.approved(payload.user)
  }

  @MessagePattern({ cmd: 'expense.decide' })
  decide(
    @Payload()
    payload: {
      user: ExpenseUser
      id: string
      input: DecideExpenseRequest
    },
  ) {
    return this.expenseService.decide(payload.user, payload.id, payload.input)
  }
}
