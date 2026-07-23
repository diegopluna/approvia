import { HttpInterceptorFn } from '@angular/common/http'
import { inject } from '@angular/core'
import { from, switchMap } from 'rxjs'
import { AuthService } from './auth.service'

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const url = new URL(req.url, location.origin)
  const isApiRequest =
    url.origin === location.origin &&
    (url.pathname === '/api' || url.pathname.startsWith('/api/'))

  if (!isApiRequest) return next(req)

  const auth = inject(AuthService)
  return from(auth.getToken()).pipe(
    switchMap((token) =>
      next(
        token
          ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
          : req,
      ),
    ),
  )
}
