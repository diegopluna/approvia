import { Module } from '@nestjs/common'
import { AuthController } from './auth.controller'
import { KeycloakService } from './keycloak.service'

@Module({
  controllers: [AuthController],
  providers: [KeycloakService],
})
export class AuthModule {}
