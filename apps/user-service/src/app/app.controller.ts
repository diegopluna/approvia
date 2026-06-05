import { Controller, HttpException, HttpStatus } from '@nestjs/common'
import { AppService } from './app.service'
import { MessagePattern, Payload, RpcException } from '@nestjs/microservices'
import {
  LoginRequest,
  LoginResponse,
  USER_SERVICE_PATTERNS,
} from '@approvia/contracts'

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @MessagePattern(USER_SERVICE_PATTERNS.LOGIN)
  async login(@Payload() request: LoginRequest): Promise<LoginResponse> {
    try {
      return await this.appService.login(request)
    } catch (error) {
      throw this.toRpcException(error)
    }
  }

  private toRpcException(error: unknown): RpcException {
    if (error instanceof HttpException) {
      const response = error.getResponse()

      if (typeof response === 'string') {
        return new RpcException({
          statusCode: error.getStatus(),
          message: response,
        })
      }

      return new RpcException(response)
    }

    return new RpcException({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    })
  }
}
