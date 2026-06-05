import {
  LoginRequest,
  LoginResponse,
  USER_SERVICE_PATTERNS,
} from '@approvia/contracts'
import {
  BadGatewayException,
  GatewayTimeoutException,
  HttpException,
  Inject,
  Injectable,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common'
import { ClientProxy } from '@nestjs/microservices'
import { firstValueFrom, timeout, TimeoutError } from 'rxjs'

export const USER_SERVICE_CLIENT = 'USER_SERVICE_CLIENT'

@Injectable()
export class AppService implements OnModuleDestroy {
  constructor(
    @Inject(USER_SERVICE_CLIENT)
    private readonly userServiceClient: ClientProxy,
  ) {}

  async login(request: LoginRequest): Promise<LoginResponse> {
    try {
      return await firstValueFrom(
        this.userServiceClient
          .send<
            LoginResponse,
            LoginRequest
          >(USER_SERVICE_PATTERNS.LOGIN, request)
          .pipe(timeout(10000)),
      )
    } catch (error) {
      this.handleUserServiceError(error)
    }
  }

  onModuleDestroy() {
    return this.userServiceClient.close()
  }

  private handleUserServiceError(error: unknown): never {
    if (this.isRpcHttpError(error)) {
      throw new HttpException(error, error.statusCode)
    }
    if (error instanceof TimeoutError) {
      throw new GatewayTimeoutException('User service login request timed out')
    }

    if (error instanceof Error && error.message.includes('ECONNREFUSED')) {
      throw new ServiceUnavailableException('User service is unavailable')
    }

    throw new BadGatewayException('User service login failed')
  }

  private isRpcHttpError(
    error: unknown,
  ): error is {
    statusCode: number
    message: string | string[]
    error?: string
  } {
    return (
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof (error as { statusCode?: unknown }).statusCode === 'number'
    )
  }
}
