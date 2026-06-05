import { Body, Controller, Post } from '@nestjs/common'
import { AppService } from './app.service'
import {
  LoginRequest,
  LoginResponse,
  LogoutRequest,
  LogoutResponse,
  RefreshRequest,
} from '@approvia/contracts'
import { IsNotEmpty, IsString } from 'class-validator'

class LoginDto implements LoginRequest {
  @IsString()
  @IsNotEmpty()
  email!: string

  @IsString()
  @IsNotEmpty()
  password!: string
}

class RefreshDto implements RefreshRequest {
  @IsString() @IsNotEmpty() refresh_token!: string
}
class LogoutDto implements LogoutRequest {
  @IsString() @IsNotEmpty() refresh_token!: string
}

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Post('login')
  login(@Body() request: LoginDto): Promise<LoginResponse> {
    return this.appService.login(request)
  }

  @Post('refresh')
  refresh(@Body() req: RefreshDto): Promise<LoginResponse> {
    return this.appService.refresh(req)
  }

  @Post('logout')
  logout(@Body() req: LogoutDto): Promise<LogoutResponse> {
    return this.appService.logout(req)
  }
}
