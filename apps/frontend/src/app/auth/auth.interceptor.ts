import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http'
import { inject } from '@angular/core'
import { Router } from '@angular/router'
import {
  BehaviorSubject,
  catchError,
  filter,
  switchMap,
  take,
  throwError,
} from 'rxjs'
import { AuthService } from './auth.service'

let isRefreshing = false
const newToken$ = new BehaviorSubject<string | null>(null)

const AUTH_PATHS = ['/api/login', '/api/refresh', '/api/logout']

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService)
  const router = inject(Router)
  const isAuthPath = AUTH_PATHS.some((p) => req.url.includes(p))
  const token = auth.accessToken()

  const authReq =
    token && !isAuthPath
      ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
      : req

  return next(authReq).pipe(
    catchError((err: HttpErrorResponse) => {
      if (err.status !== 401 || isAuthPath) return throwError(() => err)

      if (!auth.refreshToken) {
        auth.clear()
        router.navigate(['/login'])
        return throwError(() => err)
      }

      if (isRefreshing) {
        return newToken$.pipe(
          filter((t): t is string => t !== null),
          take(1),
          switchMap((t) =>
            next(req.clone({ setHeaders: { Authorization: `Bearer ${t}` } })),
          ),
        )
      }

      isRefreshing = true
      newToken$.next(null)
      return auth.refresh().pipe(
        switchMap((res) => {
          isRefreshing = false
          newToken$.next(res.access_token)
          return next(
            req.clone({
              setHeaders: { Authorization: `Bearer ${res.access_token}` },
            }),
          )
        }),
        catchError((refreshErr) => {
          isRefreshing = false
          auth.clear()
          router.navigate(['/login'])
          return throwError(() => refreshErr)
        }),
      )
    }),
  )
}
