import { HttpClient } from '@angular/common/http'
import { inject, Injectable } from '@angular/core'

export type PurchaseRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED'

export type PurchaseRequest = {
  id: string
  title: string
  justification: string
  amount: string
  currency: 'BRL'
  status: PurchaseRequestStatus
  requesterName: string
  createdAt: string
  decidedByName: string | null
  decisionComment: string | null
  decidedAt: string | null
}

export type NewPurchaseRequest = {
  title: string
  amount: string
  justification: string
}

@Injectable({ providedIn: 'root' })
export class PurchaseRequestsService {
  private readonly http = inject(HttpClient)
  private readonly baseUrl = '/api/purchase-requests'

  create(input: NewPurchaseRequest, idempotencyKey: string) {
    return this.http.post<PurchaseRequest>(this.baseUrl, input, {
      headers: { 'Idempotency-Key': idempotencyKey },
    })
  }

  mine() {
    return this.http.get<PurchaseRequest[]>(`${this.baseUrl}/mine`)
  }

  pending() {
    return this.http.get<PurchaseRequest[]>(`${this.baseUrl}/pending`)
  }

  approved() {
    return this.http.get<PurchaseRequest[]>(`${this.baseUrl}/approved`)
  }

  decide(
    id: string,
    decision: 'APPROVED' | 'REJECTED',
    comment?: string,
  ) {
    return this.http.post<PurchaseRequest>(`${this.baseUrl}/${id}/decision`, {
      decision,
      ...(comment ? { comment } : {}),
    })
  }
}
