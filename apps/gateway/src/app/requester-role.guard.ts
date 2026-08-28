import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'

type AuthenticatedRequest = {
  user?: {
    realm_access?: {
      roles?: unknown
    }
  }
}

@Injectable()
export class RequesterRoleGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    const roles = request.user?.realm_access?.roles

    return Array.isArray(roles) && !roles.includes('approver')
  }
}
