# Contract: HTTP Surface Changes (gateway)

Authentication/authorization unchanged (Keycloak roles; gateway is the only HTTP owner). No new
endpoints — existing request read/decision surface is extended.

## Request payloads (list + detail reads)

Purchase-request responses gain:

```jsonc
{
  // existing fields unchanged …
  "status": "PENDING | APPROVED | REJECTED | EXPIRED",   // new enum member
  "decisionDeadlineAt": "2026-08-29T12:00:00.000Z",       // null for pre-feature requests
  "expiredAt": null,                                       // set when status is EXPIRED
  "activities": [                                          // detail view; newest last
    { "kind": "REMINDER_SENT", "occurrence": 1, "occurredAt": "…" },
    { "kind": "EXPIRED", "occurrence": null, "occurredAt": "…" }
  ]
}
```

## Decision commands (approve / reject)

- On a request whose status is not `PENDING` (decided **or expired**): **409 Conflict** with a
  machine-readable code and human message, e.g.

```jsonc
{ "statusCode": 409, "error": "Conflict", "code": "REQUEST_NOT_PENDING",
  "message": "This request expired on 2026-08-29 and can no longer be decided." }
```

- The expense service is the source of truth (conditional update); the gateway propagates the
  conflict result. Frontend renders the message and refreshes the request (FR-006).

## Frontend expectations (consumer of this contract)

- Deadline shown on request cards/detail for requester and approvers (FR-010).
- `EXPIRED` rendered as a distinct terminal state; expired requests offer no decision actions.
- Detail view renders `activities` as the request history (FR-011 / User Story 3).
