import { Component, inject, signal } from '@angular/core'
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms'
import { AuthService } from '../auth/auth.service'
import { Router } from '@angular/router'

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="submit()">
      <input type="email" formControlName="email" placeholder="Email" />
      <input
        type="password"
        formControlName="password"
        placeholder="Password"
      />
      <button type="submit" [disabled]="form.invalid || loading()">
        {{ loading() ? 'Signing in…' : 'Sign in' }}
      </button>
      @if (error()) {
        <p role="alert">{{ error() }}</p>
      }
    </form>
  `,
})
export class Login {
  private fb = inject(FormBuilder)
  private auth = inject(AuthService)
  private router = inject(Router)

  loading = signal(false)
  error = signal<string | null>(null)

  form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  })

  submit() {
    if (this.form.invalid) return
    this.loading.set(true)
    this.error.set(null)
    const { email, password } = this.form.getRawValue()
    this.auth.login(email, password).subscribe({
      next: () => this.router.navigate(['/']),
      error: () => {
        this.error.set('Invalid email or password')
        this.loading.set(false)
      },
    })
  }
}
