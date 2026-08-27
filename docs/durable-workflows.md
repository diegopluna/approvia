# Durable approval workflows

Status: implemented (feature `specs/001-durable-workflows/`). Reminders and
auto-expiry for purchase requests, orchestrated by self-hosted Temporal.

## What it does

- Every request gets a `decision_deadline_at` at submission
  (`APPROVAL_DECISION_TTL_HOURS`, default 120h).
- Pending requests trigger reminder emails to eligible approvers
  (`APPROVAL_REMINDER_DELAY_HOURS` after submission, repeating every
  `APPROVAL_REMINDER_INTERVAL_HOURS`).
- A request undecided at its deadline transitions to the terminal `EXPIRED`
  state; the requester is emailed and further decisions return
  `409 REQUEST_NOT_PENDING`.
- Reminders and expiry are recorded in `request_activities` and shown as the
  request history in the frontend.

## Architecture

One Temporal workflow per request (`approval-<requestId>`, task queue
`approval-lifecycle`), started and signalled from the expense service's own
outbox-published events consumed on the durable `expense.workflows` queue:

- `expense.request.created.v1` → start workflow (duplicate starts are no-ops
  thanks to the deterministic workflow id).
- `expense.request.approved.v1` / `rejected.v1` → `decided` signal; the
  workflow cancels its timers and completes.

The workflow (`apps/expense/src/app/workflows/approval.workflow.ts`) only owns
*timing*. Its activities call expense-service commands that own all state:

- `sendReminder` → `ExpenseService.recordReminder`: inside one transaction,
  guard `status = PENDING`, insert `request_activities (REMINDER_SENT, n)`
  (unique per occurrence), and write the `expense.request.reminder.v1` outbox
  event.
- `expireRequest` → `ExpenseService.expireRequest`: conditional
  `PENDING → EXPIRED` update (0 rows = a decision won the race, no-op), plus
  history row and `expense.request.expired.v1` outbox event.

Emails keep flowing through the existing outbox → RabbitMQ → notifications
path. Reminder recipients are the eligible approvers at send time (Keycloak);
the expiry notice goes to the requester.

## Exactly-once effects

Delivery is at least once end to end; effects are deduplicated by:

- deterministic workflow id `approval-<requestId>` (duplicate starts rejected);
- deterministic event ids `uuidv5('<requestId>:reminder:<n>')` and
  `uuidv5('<requestId>:expired')`, used as the outbox row id and payload
  `eventId`, colliding with the notifications service's
  `(eventId, recipient, template, templateVersion)` unique constraint;
- the `request_activities (request_id, kind, occurrence)` unique index as the
  producer-side backstop;
- the conditional status update making expiry once-only and decision-wins.

If Temporal, the worker, or the whole stack is down at a scheduled moment, the
timers fire on recovery — late, never lost (validated manually via
`specs/001-durable-workflows/quickstart.md`, Scenario 4).

## Operations

- Compose services: `temporal` (`temporalio/auto-setup`, persists to the shared
  Postgres) and `temporal-ui` (http://localhost:8233).
- The worker runs inside the expense service, gated by `WORKFLOWS_ENABLED`
  (set to `false` in tests). It retries the Temporal connection in the
  background, so the expense service works with Temporal down (timers pause).
- Config changes affect only requests submitted after the change: the deadline
  is stored on the row and reminder cadence is pinned as workflow input.
