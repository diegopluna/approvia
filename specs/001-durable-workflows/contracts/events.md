# Contract: Integration Events (packages/events)

New versioned events on the existing `approvia.events` topic exchange, following the established
envelope (`eventId`, `eventName`, `occurredAt`, `aggregateId`, `correlationId`, `data`). No
tokens or credentials in payloads. Parsers + tests live in `packages/events` before any
producer/consumer code (Constitution II).

## expense.request.reminder.v1

Produced by the expense service (`recordReminder` command, via outbox) once per due reminder
occurrence. Consumed by notifications → one email per eligible approver.

```jsonc
{
  "eventId": "<uuidv5 of '<requestId>:reminder:<occurrence>'>", // deterministic → dedupe
  "eventName": "expense.request.reminder.v1",
  "occurredAt": "2026-08-25T12:00:00.000Z",
  "aggregateId": "<requestId>",
  "correlationId": "<requestId>",
  "data": {
    "request": { /* ExpenseRequestSnapshot — same shape as existing events */ },
    "reminder": {
      "occurrence": 1,                                // 1-based
      "decisionDeadlineAt": "2026-08-29T12:00:00.000Z"
    }
  }
}
```

Recipients: eligible approvers at send time, resolved by the notifications service via the
existing `KeycloakRecipientService` (same rule as `created.v1`). Template:
`approver-reminder` v1.

## expense.request.expired.v1

Produced by the expense service in the same transaction as the `PENDING → EXPIRED` transition.
Consumed by notifications → one email to the requester.

```jsonc
{
  "eventId": "<uuidv5 of '<requestId>:expired'>",     // deterministic → dedupe
  "eventName": "expense.request.expired.v1",
  "occurredAt": "2026-08-29T12:00:03.000Z",
  "aggregateId": "<requestId>",
  "correlationId": "<requestId>",
  "data": {
    "request": { /* ExpenseRequestSnapshot */ },
    "expiry": {
      "decisionDeadlineAt": "2026-08-29T12:00:00.000Z",
      "expiredAt": "2026-08-29T12:00:03.000Z"
    }
  }
}
```

Recipient: `request.requesterEmail`. Template: `requester-expired` v1 (states that a new request
must be submitted if still needed — FR-005).

## Contract changes to packages/events

- `EXPENSE_EVENT_NAMES` gains `reminder` and `expired` keys.
- New types `ExpenseRequestReminderEvent`, `ExpenseRequestExpiredEvent`; union
  `ExpenseIntegrationEvent` extended.
- `parseExpenseIntegrationEvent` extended (reject mismatched shapes, as today).
- `ExpenseRequestSnapshot` unchanged.

## Queue bindings

| Queue | Bindings | Consumer | Ack rule |
|-------|----------|----------|----------|
| `notifications.email` (existing) | + `expense.request.reminder.v1`, `expense.request.expired.v1` | notifications | after delivery state persisted (unchanged) |
| `expense.workflows` (new, durable) | `expense.request.created.v1`, `expense.request.approved.v1`, `expense.request.rejected.v1` | expense lifecycle consumer | after Temporal start/signal succeeds; already-started / already-completed treated as success |
