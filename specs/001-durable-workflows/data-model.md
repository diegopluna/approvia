# Data Model: Durable Approval Workflows

Expense-service schema (`public`) only; notifications schema is unchanged (its existing
`EmailDelivery` unique constraint provides delivery dedupe). All changes ship as Prisma
migrations.

## PurchaseRequest (extended)

| Field | Type | Change | Notes |
|-------|------|--------|-------|
| `status` | `PurchaseRequestStatus` | enum gains `EXPIRED` | Closed enum: `PENDING`, `APPROVED`, `REJECTED`, `EXPIRED` |
| `decisionDeadlineAt` | `timestamptz(3)` nullable | new | Computed at submission (`createdAt + APPROVAL_DECISION_TTL_HOURS`). `NULL` only for pre-feature rows, which get no automated workflow. |
| `expiredAt` | `timestamptz(3)` nullable | new | Set when expiry transition wins. |

Existing decision fields (`decidedById`, `decidedByName`, `decisionComment`, `decidedAt`) remain
`NULL` on expired requests.

### State transitions

```text
PENDING ──approve──▶ APPROVED   (terminal)
PENDING ──reject───▶ REJECTED   (terminal; comment required, unchanged)
PENDING ──deadline─▶ EXPIRED    (terminal; system-initiated only)
```

Guards (all enforced in the expense service, single transaction each):

- Approve/reject: `UPDATE … WHERE id = ? AND status = 'PENDING'`; 0 rows → conflict error
  ("request already decided or expired") surfaced to the gateway.
- Expire: `UPDATE … WHERE id = ? AND status = 'PENDING'` setting `status = 'EXPIRED'`,
  `expired_at = now()`; 0 rows → no-op success (decision won the race, FR-007).
- No transition ever leaves a terminal state.

## RequestActivity (new)

Automated-action history (FR-011), written in the same transaction as the corresponding outbox
event.

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid PK | |
| `requestId` | uuid, indexed | references `purchase_requests.id` |
| `kind` | enum `RequestActivityKind` | `REMINDER_SENT` \| `EXPIRED` |
| `occurrence` | int nullable | reminder occurrence number (1-based); `NULL` for `EXPIRED` |
| `occurredAt` | `timestamptz(3)` default now | |
| `details` | Json nullable | e.g. recipient count for reminders |

Constraints:

- `@@unique([requestId, kind, occurrence])` — idempotency backstop for activity retries
  (`EXPIRED` uses occurrence `NULL`; the status guard already makes expiry once-only).
- `@@index([requestId, occurredAt])` — history reads.

## OutboxEvent (unchanged mechanics, new usage)

Reminder/expired events are inserted with **deterministic ids**
(`uuidv5("<requestId>:reminder:<n>")`, `uuidv5("<requestId>:expired")`) so redundant inserts from
activity retries dedupe downstream at `EmailDelivery(eventId, recipient, template,
templateVersion)`. See [contracts/events.md](contracts/events.md).

## Workflow state (owned by Temporal, not the app schema)

Per request, workflow `approval-<requestId>` durably tracks: reminder delay/interval inputs,
next occurrence number, deadline timer, and whether `decided` was signalled. This state lives in
Temporal's own `temporal` database and is never read by application queries — application truth
stays in `purchase_requests` / `request_activities`.
