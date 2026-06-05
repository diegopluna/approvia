import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { validateEnv } from '../config/env.validation'
import { AuthModule } from './auth/auth.module'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
      validate: validateEnv,
    }),
    AuthModule,
  ],
})
export class AppModule {}
