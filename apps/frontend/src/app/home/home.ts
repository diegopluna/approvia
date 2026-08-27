import { CurrencyPipe, DatePipe } from '@angular/common'
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core'
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms'
import { MatButtonModule } from '@angular/material/button'
import { MatCardModule } from '@angular/material/card'
import { MatChipsModule } from '@angular/material/chips'
import { MatDividerModule } from '@angular/material/divider'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatInputModule } from '@angular/material/input'
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner'
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar'
import { MatToolbarModule } from '@angular/material/toolbar'
import { firstValueFrom } from 'rxjs'
import { AuthService } from '../auth/auth.service'
import {
  PurchaseRequest,
  PurchaseRequestsService,
  RequestActivity,
} from '../purchase-requests/purchase-requests.service'
import {
  activityLabel,
  decisionConflictMessage,
  statusLabel,
} from '../purchase-requests/purchase-request-view'

@Component({
  selector: 'app-home',
  imports: [
    DatePipe,
    CurrencyPipe,
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatDividerModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatToolbarModule,
  ],
  templateUrl: './home.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Home {
  private readonly auth = inject(AuthService)
  private readonly api = inject(PurchaseRequestsService)
  private readonly formBuilder = inject(FormBuilder)
  private readonly snackBar = inject(MatSnackBar)

  readonly displayName = this.auth.displayName()
  readonly isApprover = this.auth.hasRealmRole('approver')
  readonly requests = signal<PurchaseRequest[]>([])
  readonly pending = signal<PurchaseRequest[]>([])
  readonly approved = signal<PurchaseRequest[]>([])
  readonly loading = signal(true)
  readonly pageError = signal('')
  readonly formError = signal('')
  readonly formOpen = signal(false)
  readonly actionId = signal<string | null>(null)
  readonly rejectingId = signal<string | null>(null)

  // Chave de idempotência do create: gerada no envio e reutilizada em
  // retentativas do mesmo conteúdo (ex.: reenviar após timeout com a escrita
  // já feita); qualquer edição do formulário zera e força chave nova.
  private createIdempotencyKey = ''

  readonly requestForm = this.formBuilder.nonNullable.group({
    title: [
      '',
      [Validators.required, Validators.minLength(3), Validators.maxLength(120)],
    ],
    amount: [
      '',
      [
        Validators.required,
        Validators.pattern(/^(?:0|[1-9]\d{0,5})(?:[.,]\d{1,2})?$/),
      ],
    ],
    justification: [
      '',
      [Validators.required, Validators.minLength(5), Validators.maxLength(1000)],
    ],
  })

  readonly rejectionForm = this.formBuilder.nonNullable.group({
    comment: ['', [Validators.required, Validators.maxLength(1000)]],
  })

  constructor() {
    this.requestForm.valueChanges.subscribe(() => {
      this.createIdempotencyKey = ''
    })
    void this.load()
  }

  async load() {
    this.loading.set(true)
    this.pageError.set('')

    try {
      if (this.isApprover) {
        const [pending, approved] = await Promise.all([
          firstValueFrom(this.api.pending()),
          firstValueFrom(this.api.approved()),
        ])
        this.pending.set(pending)
        this.approved.set(approved)
      } else {
        this.requests.set(await firstValueFrom(this.api.mine()))
      }
    } catch {
      this.pageError.set('Não foi possível carregar as solicitações.')
    } finally {
      this.loading.set(false)
    }
  }

  openForm() {
    this.formError.set('')
    this.formOpen.set(true)
  }

  closeForm() {
    this.formOpen.set(false)
    this.requestForm.reset()
    this.formError.set('')
  }

  async submitRequest() {
    if (this.requestForm.invalid) {
      this.requestForm.markAllAsTouched()
      return
    }

    this.actionId.set('create')
    this.formError.set('')
    const value = this.requestForm.getRawValue()
    this.createIdempotencyKey ||= crypto.randomUUID()

    try {
      const created = await firstValueFrom(
        this.api.create(
          {
            title: value.title.trim(),
            amount: value.amount.replace(',', '.'),
            justification: value.justification.trim(),
          },
          this.createIdempotencyKey,
        ),
      )
      this.requests.update((requests) => [created, ...requests])
      this.closeForm()
      this.snackBar.open('Solicitação enviada para aprovação.', undefined, {
        duration: 3000,
      })
    } catch {
      this.formError.set('Não foi possível enviar a solicitação.')
    } finally {
      this.actionId.set(null)
    }
  }

  startRejecting(id: string) {
    this.rejectionForm.reset()
    this.rejectingId.set(id)
  }

  cancelRejecting() {
    this.rejectingId.set(null)
    this.rejectionForm.reset()
  }

  async decide(id: string, decision: 'APPROVED' | 'REJECTED') {
    if (decision === 'REJECTED' && this.rejectionForm.invalid) {
      this.rejectionForm.markAllAsTouched()
      return
    }

    this.actionId.set(id)
    this.pageError.set('')

    try {
      const comment =
        decision === 'REJECTED'
          ? this.rejectionForm.controls.comment.value.trim()
          : undefined
      const decided = await firstValueFrom(
        this.api.decide(id, decision, comment),
      )
      this.pending.update((requests) =>
        requests.filter((request) => request.id !== id),
      )
      if (decision === 'APPROVED') {
        this.approved.update((requests) => [decided, ...requests])
      }
      this.cancelRejecting()
      this.snackBar.open(
        decision === 'APPROVED'
          ? 'Solicitação aprovada.'
          : 'Solicitação rejeitada.',
        undefined,
        { duration: 3000 },
      )
    } catch (error) {
      this.pageError.set(
        decisionConflictMessage(error) ??
          'Não foi possível atualizar a solicitação. Ela pode já ter sido analisada.',
      )
      await this.load()
    } finally {
      this.actionId.set(null)
    }
  }

  statusLabel(status: PurchaseRequest['status']): string {
    return statusLabel(status)
  }

  activityLabel(activity: RequestActivity): string {
    return activityLabel(activity)
  }

  logout() {
    void this.auth.logout()
  }
}
