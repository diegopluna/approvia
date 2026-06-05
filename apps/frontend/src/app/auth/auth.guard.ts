import { inject } from '@angular/core'
import { CanActivateFn, Router } from '@angular/router'
import { AuthService } from './auth.service'
import { catchError, map, of } from 'rxjs'

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService)
  const router = inject(Router)

  if (auth.isAuthenticated()) return true

  if (auth.refreshToken) {
    return auth.refresh().pipe(
      map(() => true),
      catchError(() => {
        auth.clear()
        return of(router.createUrlTree(['/login']))
      }),
    )
  }
  return router.createUrlTree(['/login'])
}
