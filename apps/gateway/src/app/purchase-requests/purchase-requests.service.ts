import {
  BadGatewayException,
  GatewayTimeoutException,
  HttpException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { ClientProxy } from '@nestjs/microservices'
import { firstValueFrom, timeout, TimeoutError } from 'rxjs'
import { EXPENSE_SERVICE } from '../expense-client'
import {
  CreatePurchaseRequestDto,
  DecidePurchaseRequestDto,
} from './purchase-request.dto'

type TokenUser = {
  sub?: unknown
  name?: unknown
  preferred_username?: unknown
  email?: unknown
}

type CurrentUser = {
  id: string
  name: string
  email: string
}

@Injectable()
export class PurchaseRequestsService {
  constructor(
    @Inject(EXPENSE_SERVICE) private readonly expenseClient: ClientProxy,
  ) {}

  create(
    tokenUser: TokenUser,
    input: CreatePurchaseRequestDto,
    idempotencyKey: string,
  ) {
    return this.send('expense.create', {
      user: this.currentUser(tokenUser),
      input,
      idempotencyKey,
    })
  }

  mine(tokenUser: TokenUser) {
    return this.send('expense.mine', { user: this.currentUser(tokenUser) })
  }

  pending(tokenUser: TokenUser) {
    return this.send('expense.pending', { user: this.currentUser(tokenUser) })
  }

  approved(tokenUser: TokenUser) {
    return this.send('expense.approved', { user: this.currentUser(tokenUser) })
  }

  decide(tokenUser: TokenUser, id: string, input: DecidePurchaseRequestDto) {
    return this.send('expense.decide', {
      user: this.currentUser(tokenUser),
      id,
      input,
    })
  }

  private async send(command: string, payload: unknown) {
    try {
      return await firstValueFrom(
        this.expenseClient
          .send({ cmd: command }, payload)
          .pipe(
            timeout(Number(process.env.EXPENSE_SERVICE_TIMEOUT_MS ?? 5000)),
          ),
      )
    } catch (error) {
      if (error instanceof TimeoutError) {
        throw new GatewayTimeoutException('O serviço de despesas não respondeu')
      }

      if (
        typeof error === 'object' &&
        error !== null &&
        'statusCode' in error &&
        typeof error.statusCode === 'number' &&
        'message' in error &&
        typeof error.message === 'string'
      ) {
        throw new HttpException(error.message, error.statusCode)
      }

      throw new BadGatewayException('O serviço de despesas está indisponível')
    }
  }

  private currentUser(tokenUser: TokenUser): CurrentUser {
    if (typeof tokenUser.sub !== 'string' || !tokenUser.sub) {
      throw new UnauthorizedException('Token sem identificação do usuário')
    }

    const displayName = [
      tokenUser.name,
      tokenUser.preferred_username,
      tokenUser.email,
    ].find((value): value is string => typeof value === 'string' && !!value)

    if (typeof tokenUser.email !== 'string' || !tokenUser.email.includes('@')) {
      throw new UnauthorizedException('Token sem email do usuário')
    }

    return {
      id: tokenUser.sub,
      name: displayName ?? tokenUser.sub,
      email: tokenUser.email,
    }
  }
}
