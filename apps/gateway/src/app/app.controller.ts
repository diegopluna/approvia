import { Controller, Get, Request, UseGuards } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { RealmRoleGuard } from './realm-role.guard'

@Controller()
export class AppController {
  @Get('me')
  @UseGuards(AuthGuard('jwt'), RealmRoleGuard)
  me(@Request() req: { user: Record<string, unknown> }) {
    return req.user
  }
}
