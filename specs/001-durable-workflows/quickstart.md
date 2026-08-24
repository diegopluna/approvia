# Quickstart Validation: Durable Approval Workflows

Runnable scenarios proving the feature end-to-end. Contracts: [events](contracts/events.md),
[workflow](contracts/workflow.md), [http](contracts/http.md); schema: [data-model.md](data-model.md).

## Prerequisites

```sh
pnpm install
docker compose -f infra/docker-compose.yml up -d --wait   # now includes temporal + temporal-ui
pnpm expense:db:migrate
pnpm notifications:db:migrate
```

Consoles: app http://localhost:4200 · Mailpit http://localhost:8025 ·
Temporal UI http://localhost:8233 · RabbitMQ http://localhost:15672.

Accounts: `test@approvia.dev` / `password123` (requester),
`approver@approvia.dev` / `password123` (approver).

## Fast-clock configuration (local validation only)

Run the expense service with minute-scale timers so scenarios complete quickly:

```sh
APPROVAL_DECISION_TTL_HOURS=0.05 \        # deadline ≈ 3 minutes
APPROVAL_REMINDER_DELAY_HOURS=0.017 \     # first reminder ≈ 1 minute
APPROVAL_REMINDER_INTERVAL_HOURS=0.017 \  # then every ≈ 1 minute
pnpm dev:expense
```

Also start: `pnpm dev:notifications`, `pnpm dev:gateway`, `pnpm dev:frontend`.

## Scenario 1 — Reminders fire and stop on decision (User Story 1)

1. As `test@approvia.dev`, submit a request. Expect: detail view shows a decision deadline;
   Temporal UI shows workflow `approval-<requestId>` running.
2. Wait ~1 minute. Expect: Mailpit shows one `approver-reminder` email per eligible approver;
   request history shows `REMINDER_SENT` occurrence 1. Wait another minute → occurrence 2, no
   duplicates per occurrence.
3. As `approver@approvia.dev`, approve the request. Expect: workflow completes in Temporal UI;
   no further reminder emails arrive after the decision.

## Scenario 2 — Undecided request expires (User Story 2)

1. Submit a request and let the deadline (~3 min) pass with no decision.
2. Expect: status becomes **Expired** (frontend badge); requester receives the
   `requester-expired` email in Mailpit; history shows `EXPIRED`; workflow completed.
3. As the approver, attempt to approve it (e.g. re-submitting a stale detail view). Expect:
   **409 Conflict** with the "request expired" message; status remains Expired.

## Scenario 3 — Decision wins the race / no expiry after decision

1. Submit a request; approve it ~30s before the deadline.
2. Expect: status stays Approved after the deadline passes; no `EXPIRED` history entry; no
   expired email.

## Scenario 4 — Outage recovery, exactly once (FR-008/FR-009, SC-004)

1. Submit a request, then stop the expense service (and optionally
   `docker compose stop temporal`) before the first reminder is due.
2. Wait past the reminder due time (and past the deadline for a second variant), then restart
   everything.
3. Expect: the missed reminder (or expiry) fires shortly after recovery — exactly one email per
   approver per occurrence in Mailpit, exactly one history entry; nothing lost, nothing doubled.

## Scenario 5 — Visibility (User Story 3)

1. Open a pending request as requester and as approver. Expect: deadline visible in both views.
2. After Scenarios 1–2: history lists each reminder occurrence and the expiry with timestamps.

## Automated checks

```sh
pnpm test:all        # events contracts, workflow time-skipping tests, notifications, frontend,
                     # gateway-e2e (includes 409-on-expired scenario)
```

Expected: all suites green; workflow tests cover reminder cadence, deadline expiry, and
signal-cancels-timers without real waiting (time-skipping environment).
