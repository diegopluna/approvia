import { Route } from '@angular/router'
import { authGuard } from './auth/auth.guard'

export const appRoutes: Route[] = [
  {
    path: 'login',
    loadComponent: () => import('./login/login').then((m) => m.Login),
  },
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
