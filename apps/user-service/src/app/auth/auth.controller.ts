import { Controller, HttpException, HttpStatus } from '@nestjs/common'
import { KeycloakService } from './keycloak.service'
import { MessagePattern, Payload, RpcException } from '@nestjs/microservices'
import {
  LoginRequest,
  LoginResponse,
  LogoutRequest,
  LogoutResponse,
  RefreshRequest,
  USER_SERVICE_PATTERNS,
} from '@approvia/contracts'

@Controller()
export class AuthController {
  constructor(private readonly keycloak: KeycloakService) {}

  @MessagePattern(USER_SERVICE_PATTERNS.LOGIN)
  async login(@Payload() req: LoginRequest): Promise<LoginResponse> {
    try {
      return await this.keycloak.login(req.email, req.password)
    } catch (error) {
      throw this.toRpc(error)
    }
  }

  @MessagePattern(USER_SERVICE_PATTERNS.REFRESH)
  async refresh(@Payload() req: RefreshRequest): Promise<LoginResponse> {
    try {
      return await this.keycloak.refresh(req.refresh_token)
    } catch (error) {
      throw this.toRpc(error)
    }
  }

  @MessagePattern(USER_SERVICE_PATTERNS.LOGOUT)
  async logout(@Payload() req: LogoutRequest): Promise<LogoutResponse> {
    try {
      return await this.keycloak.logout(req.refresh_token)
    } catch (error) {
      throw this.toRpc(error)
    }
  }

  private toRpc(error: unknown): RpcException {
    if (error instanceof HttpException) {
      const response = error.getResponse()
      return new RpcException(
        typeof response === 'string'
          ? { statusCode: error.getStatus(), message: response }
          : response,
      )
    }
    return new RpcException({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal Server Error',
    })
  }
}
