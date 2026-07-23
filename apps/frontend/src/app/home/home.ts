import { Component, inject } from '@angular/core'
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

  logout() {
    void this.auth.logout()
  }
}
