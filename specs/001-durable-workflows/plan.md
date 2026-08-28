# Implementation Plan: Durable Approval Workflows

**Branch**: `001-durable-workflows` | **Date**: 2026-08-24 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-durable-workflows/spec.md`

## Summary

Every purchase request gets a decision deadline; pending requests trigger repeating reminder
emails to eligible approvers, and undecided requests auto-expire at the deadline. Durable
scheduling is provided by a **self-hosted Temporal** cluster (added to `infra/docker-compose.yml`,
reusing the existing Postgres container). One `approvalWorkflow` per request runs durable timers
for reminders and the deadline, and receives a `decided` signal when a decision lands. All state
mutations stay in the expense service: workflow activities invoke expense-service commands that
conditionally transition state and write outbox events; emails continue to flow through the
existing outbox → RabbitMQ → notifications path with end-to-end idempotency via deterministic
event IDs.

## Technical Context

**Language/Version**: TypeScript ~5.9 on Node.js >= 20.19 (Nx 22 monorepo, pnpm)

**Primary Dependencies**: NestJS 11 (gateway, expense, notifications), Angular 21 (frontend),
Prisma 7, amqp-connection-manager/amqplib (RabbitMQ), **new**: `@temporalio/client`,
`@temporalio/worker`, `@temporalio/workflow`, `@temporalio/testing`

**Storage**: PostgreSQL 17 — expense schema (`public`) gains `EXPIRED` status,
`decision_deadline_at`, and a `request_activities` table; Temporal server persists to
`temporal` / `temporal_visibility` databases in the same Postgres container

**Testing**: Jest via Nx (`nx test events|notifications|frontend`), `nx e2e gateway-e2e`;
workflow logic tested with `@temporalio/testing` time-skipping test environment

**Target Platform**: Node services + Angular SPA, local via `infra/docker-compose.yml`
(Postgres, Keycloak, RabbitMQ, Mailpit, **new**: temporal + temporal-ui)

**Project Type**: Web application — Nx monorepo with microservices (`apps/*`) and shared
contracts (`packages/events`)

**Performance Goals**: Expiry applied within 5 min of deadline (SC-001); reminder emails within
15 min of schedule (SC-002); missed actions within 10 min of recovery (SC-004). Temporal timer
resolution (seconds) far exceeds these windows.

**Constraints**: Offline local dev from docker-compose alone (constitution); exactly-once effect
per scheduled occurrence; decision-vs-expiry race resolved decision-first; expense service is the
sole writer of request state; no secrets in events.

**Scale/Scope**: Small internal tool — hundreds of open workflows at a time; 4 apps + 1 package
touched; 2 new integration events; 1 workflow definition with 2 activities.

## Constitution Check

*GATE: constitution v1.1.0 (amended 2026-08-24 to add Temporal to the fixed stack — user-approved
during planning; see Complexity Tracking).*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Service boundaries & single ownership | PASS | Temporal worker + workflow live inside the expense app; activities call expense-service commands. Only the expense service writes request state; notifications keeps owning delivery. Temporal orchestrates *when*, never *what*. |
| II. Contract-first, versioned events | PASS | New events `expense.request.reminder.v1` and `expense.request.expired.v1` defined in `packages/events` first, with the standard envelope (`eventId`, `eventName`, `occurredAt`, `aggregateId`/`requestId`, `correlationId`) and no secrets. |
| III. Reliable messaging (NON-NEGOTIABLE) | PASS | Workflow start/signal driven by the existing outbox-published events over a new durable queue (ack after Temporal call succeeds; idempotent via deterministic workflow ID). Expiry is a conditional `PENDING → EXPIRED` update in the same transaction as its outbox write. Deterministic (UUIDv5) event IDs make reminder/expiry emails idempotent end-to-end against the existing `EmailDelivery` unique constraint. |
| IV. Tests are the merge gate | PASS | Workflow unit tests (time-skipping env), events contract tests, notifications template/consumer tests, gateway-e2e for expired-request decision rejection; all wired into `test:all`. |
| V. Explicit data integrity | PASS | Amounts untouched (centavos). `EXPIRED` added to the closed status enum; deadline stored as `timestamptz`; all changes via committed Prisma migrations; boundary validation unchanged. |
| Technology Constraints | PASS (amended) | Temporal added to the fixed stack via constitution v1.1.0. Local dev remains fully offline: `docker compose up` + documented pnpm scripts only. |

**Post-design re-check (after Phase 1)**: no new violations introduced. The design keeps a single
writer per aggregate, versioned contracts, and outbox-mediated side effects. Gate: PASS.

## Project Structure

### Documentation (this feature)

```text
specs/001-durable-workflows/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   ├── events.md        # New integration event contracts
│   ├── workflow.md      # Temporal workflow/signal/activity contract
│   └── http.md          # Gateway API surface changes
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
infra/
└── docker-compose.yml            # + temporal (auto-setup), temporal-ui services

packages/events/src/
└── index.ts                      # + reminder.v1 / expired.v1 contracts + parsers + tests

apps/expense/
├── prisma/schema.prisma          # + EXPIRED status, decision_deadline_at, expired_at,
│                                 #   request_activities model (+ migration)
└── src/app/
    ├── expense.service.ts        # + deadline on create; decision guard for EXPIRED;
    │                             #   expireRequest / recordReminder commands
    ├── expense.controller.ts     # + activities/deadline in request detail payloads
    ├── workflows/
    │   ├── approval.workflow.ts  # durable timers + `decided` signal (deterministic code)
    │   ├── activities.ts         # sendReminder / expireRequest activity impls
    │   ├── workflow.worker.ts    # Temporal worker bootstrap (env-gated)
    │   └── lifecycle.consumer.ts # RabbitMQ queue → start workflow / signal `decided`
    └── outbox.publisher.ts       # unchanged

apps/notifications/src/app/
├── email-template.service.ts     # + reminder + expired templates
├── notifications.consumer.ts     # + bind new routing keys, route recipients
└── keycloak-recipient.service.ts # reused for approver discovery

apps/gateway/src/app/             # pass-through of new fields; 409 on expired decision
apps/frontend/src/                # deadline display, EXPIRED badge, request history list
```

**Structure Decision**: Extend the existing Nx apps in place. The Temporal workflow, worker, and
lifecycle consumer live under `apps/expense/src/app/workflows/` because the approval lifecycle is
expense-owned (Constitution I); no new app is created. Shared contracts change only in
`packages/events`.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| New infrastructure component (Temporal) — required constitution amendment v1.1.0 | Durable timers, signal handling, and resume-on-recovery semantics for per-request workflows; user-selected platform (over trigger.dev) on 2026-08-24 | A bespoke Postgres `scheduled_actions` poller (mirroring the outbox publisher) would satisfy v1 with no new infra, but was declined by the product owner in favor of a real workflow engine: it grows poorly toward multi-step chains, and reimplements timer/retry/observability machinery Temporal provides. trigger.dev Cloud rejected (breaks offline local dev); trigger.dev self-hosted rejected (~6 extra services for two timers). |
