# Contract: Temporal Approval Workflow

Task queue: `approval-lifecycle`. Namespace: `default`. Worker runs inside the expense service
(env-gated by `WORKFLOWS_ENABLED`).

## Workflow: `approvalWorkflow`

- **Workflow ID**: `approval-<requestId>` — deterministic; duplicate starts rejected and treated
  as success by the lifecycle consumer (idempotent start).
- **Input** (pinned at start; config changes never affect in-flight requests — FR-012):

```jsonc
{
  "requestId": "uuid",
  "decisionDeadlineAt": "ISO-8601",     // absolute, from the request row
  "reminderDelayMs": 86400000,          // first reminder after this
  "reminderIntervalMs": 86400000        // subsequent cadence
}
```

- **Signals**:
  - `decided` (no payload): a decision was durably recorded. Workflow stops all timers and
    completes. Signalling a completed workflow is a no-op for the consumer.
- **Behavior**:
  1. Wait `reminderDelayMs` or until `decided` / deadline, whichever first.
  2. Each reminder tick before the deadline: execute `sendReminder(requestId, occurrence)`;
     occurrence increments monotonically from 1.
  3. At `decisionDeadlineAt` (if not `decided`): execute `expireRequest(requestId)`, then
     complete. Reminder timers after expiry never fire (edge case: "reminder due after expiry").
  4. On `decided` at any point: cancel pending timers, complete without further activities.
- **Determinism**: workflow code uses only Temporal time/sleep APIs; all I/O in activities.

## Activities (implemented in the expense service)

| Activity | Effect | Idempotency | Retry policy |
|----------|--------|-------------|--------------|
| `sendReminder(requestId, occurrence)` | Expense command `recordReminder`: if request still `PENDING`, insert `request_activities (REMINDER_SENT, occurrence)` + outbox `reminder.v1` with deterministic eventId, one transaction. If not pending or occurrence already recorded → no-op success. | unique `(requestId, kind, occurrence)` + deterministic eventId → at-most-once email per occurrence (FR-009) | default exponential, non-retryable on validation errors |
| `expireRequest(requestId)` | Expense command `expireRequest`: conditional `PENDING → EXPIRED` + outbox `expired.v1` + `request_activities (EXPIRED)`, one transaction. 0 rows updated → no-op success (decision won — FR-007). | status guard makes it once-only | default exponential |

## Failure semantics

- Temporal server or worker down at a scheduled moment → timers fire on recovery; activities
  execute exactly once in effect (FR-008, SC-004).
- Worker crash between side effect and activity completion → activity retries; the idempotency
  guards above absorb the duplicate.
- Lifecycle consumer crash before ack → RabbitMQ redelivers; deterministic workflow ID /
  no-op signal absorb the duplicate.
