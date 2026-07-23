import { inject } from '@angular/core'
import { CanActivateFn } from '@angular/router'
import { AuthService } from './auth.service'

export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService)
  if (auth.isAuthenticated()) return true

  await auth.login(location.origin + state.url)
  return false
}
