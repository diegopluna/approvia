import { HttpClient } from '@angular/common/http'
import { computed, inject, Injectable, signal } from '@angular/core'
import { Observable, tap, throwError } from 'rxjs'
import { LoginResponse, LogoutResponse } from '@approvia/contracts'

const REFRESH_KEY = 'approvia.refresh_token'

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient)

  private readonly _accessToken = signal<string | null>(null)
  readonly accessToken = this._accessToken.asReadonly()
  readonly isAuthenticated = computed(() => this._accessToken !== null)

  get refreshToken(): string | null {
    return localStorage.getItem(REFRESH_KEY)
  }

  login(email: string, password: string): Observable<LoginResponse> {
    return this.http
      .post<LoginResponse>('/api/login', { email, password })
      .pipe(tap((res) => this.store(res)))
  }

  refresh(): Observable<LoginResponse> {
    const refresh_token = this.refreshToken
    if (!refresh_token) {
      return throwError(() => new Error('No refresh token'))
    }
    return this.http
      .post<LoginResponse>('/api/refresh', { refresh_token })
      .pipe(tap((res) => this.store(res)))
  }

  logout(): Observable<LogoutResponse> {
    const refresh_token = this.refreshToken
    return this.http
      .post<LogoutResponse>('/api/logout', { refresh_token })
      .pipe(tap(() => this.clear()))
  }

  private store(res: LoginResponse) {
    this._accessToken.set(res.access_token)
    if (res.refresh_token) localStorage.setItem(REFRESH_KEY, res.refresh_token)
  }

  clear() {
    this._accessToken.set(null)
    localStorage.removeItem(REFRESH_KEY)
  }
}
