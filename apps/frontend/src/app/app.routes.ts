import { Route } from '@angular/router'
import { authGuard } from './auth/auth.guard'

export const appRoutes: Route[] = [
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./home/home').then((m) => m.Home),
  },
  {
    path: '**',
    redirectTo: '',
  },
]
