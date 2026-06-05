import { Component, inject } from '@angular/core'
import { Router } from '@angular/router'
import { AuthService } from '../auth/auth.service'

@Component({
  selector: 'app-home',
  template: `
    <h1>Home (protected)</h1>
    <button (click)="logout()">Log out</button>
  `,
})
export class Home {
  private auth = inject(AuthService)
  private router = inject(Router)

  logout() {
    this.auth.logout().subscribe({
      next: () => this.router.navigate(['/login']),
      error: () => this.router.navigate(['/login']),
    })
  }
}
