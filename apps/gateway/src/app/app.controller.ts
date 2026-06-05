import { Body, Controller, Post } from '@nestjs/common'
import { AppService } from './app.service'
import { LoginRequest, LoginResponse } from '@approvia/contracts'
import { IsNotEmpty, IsString } from 'class-validator'

class LoginDto implements LoginRequest {
  @IsString()
  @IsNotEmpty()
  email!: string

  @IsString()
  @IsNotEmpty()
  password!: string
}

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Post('login')
  login(@Body() request: LoginDto): Promise<LoginResponse> {
    return this.appService.login(request)
  }
}
