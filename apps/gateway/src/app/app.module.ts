import { Module } from '@nestjs/common'
import { PassportModule } from '@nestjs/passport'
import { AppController } from './app.controller'
import { JwtStrategy } from './jwt.strategy'
import { RealmRoleGuard } from './realm-role.guard'

@Module({
  imports: [PassportModule],
  controllers: [AppController],
  providers: [JwtStrategy, RealmRoleGuard],
})
export class AppModule {}
