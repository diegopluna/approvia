<!--
Sync Impact Report
==================
Version change: 1.0.0 → 1.1.0
Rationale: MINOR — Technology Constraints materially expanded: self-hosted Temporal
added to the fixed stack as the durable-workflow engine (product-owner decision,
2026-08-24, during planning of specs/001-durable-workflows; alternatives evaluated
in specs/001-durable-workflows/research.md).

Modified principles: none (Core Principles untouched)
Added sections: none (one bullet added to Technology Constraints)
Removed sections: none
Deferred items: none

Previous report (1.0.0, initial ratification): all placeholders filled from
repository context; five Core Principles, Technology Constraints, Development
Workflow & Quality Gates, Governance.
-->

# Approvia Constitution

## Core Principles

### I. Service Boundaries & Single Ownership

Every capability has exactly one owning service, and ownership is enforced at the
infrastructure boundary:

- The **gateway** owns HTTP authentication and role authorization (Keycloak). No
  other service exposes a public HTTP API or re-implements auth checks.
- The **expense** service owns purchase-request persistence and all approval
  business rules. Only the expense service reads or writes its Prisma schema.
- The **notifications** service consumes events and owns delivery state in its own
  schema. It MUST NOT query another service's tables or alter expense outcomes.
- Services MUST NOT share database tables or Prisma clients. Cross-service
  communication happens only through RabbitMQ messages defined in shared contracts.

Rationale: independent deployability and failure isolation collapse the moment two
services touch the same tables or duplicate authorization logic.

### II. Contract-First, Versioned Events

All inter-service messages are defined in the shared contracts library
(`packages/events`) before any producer or consumer code is written:

- Event names carry an explicit version suffix from creation (e.g.
  `expense.request.created.v1`). Breaking a payload requires a new version, never
  a mutation of the existing one.
- Every envelope MUST include `eventId`, `eventName`, `occurredAt`, `requestId`,
  and only the minimum template data the consumer needs.
- Events MUST NOT contain access tokens, provider credentials, or other secrets.

Rationale: versioned, minimal contracts let producers and consumers deploy
independently and make redelivery and replay safe.

### III. Reliable Messaging (NON-NEGOTIABLE)

Side effects triggered by state changes MUST NOT be lost or duplicated in effect:

- State changes that emit events write an outbox record in the same database
  transaction as the state change (transactional outbox). Direct publish-on-commit
  without an outbox is forbidden for business events.
- Delivery is at-least-once; therefore every consumer MUST be idempotent, enforced
  by a database uniqueness constraint (e.g. `eventId` + `recipient` + `template`),
  not by in-memory checks.
- Consumers acknowledge a RabbitMQ message only after the resulting state is
  persisted.
- Asynchronous side effects (e.g. email) MUST NOT delay or determine the outcome
  of the originating command.

Rationale: the broker, the database, or the process can fail at any moment; only
the outbox + idempotent-consumer pair keeps the system correct through all of them.

### IV. Tests Are the Merge Gate

`pnpm test:all` (unit tests for `events`, `frontend`, `notifications`, plus the
`gateway-e2e` suite) MUST pass before any merge to `develop` or `master`:

- New behavior ships with tests in the same change: unit tests for business rules
  and contracts, e2e coverage for gateway auth/authorization flows.
- Changes to shared contracts (`packages/events`) or inter-service messaging
  require integration or e2e coverage, not only unit tests.
- A red test is fixed or the change is reverted; tests are never skipped or
  deleted to force a green build.

Rationale: in an event-driven system most regressions appear at the seams; the
gate is only meaningful if it exercises those seams and is never bypassed.

### V. Explicit Data Integrity

Data correctness is enforced by types, validation, and migrations — not by
convention:

- Monetary amounts are stored as integer centavos and formatted as BRL only at
  the presentation layer. Floating-point money is forbidden.
- All external input is validated at the boundary (global NestJS validation
  pipes on gateway and services); unvalidated payloads never reach business logic.
- Schema changes go through committed Prisma migrations (`expense:db:migrate`,
  `notifications:db:migrate`); manual schema edits against any environment are
  forbidden.
- Domain state is modeled with closed enums (e.g. pending/approved/rejected) and
  invariants enforced in the owning service (e.g. rejection requires a comment).

Rationale: integrity rules that live only in reviewers' heads decay; encoding
them in schema and validation makes violations fail fast and visibly.

## Technology Constraints

The stack is fixed unless amended here:

- **Monorepo**: Nx workspace with pnpm (Node >= 20.19.0). New services live in
  `apps/`, shared libraries in `packages/`.
- **Backend**: NestJS services; **Frontend**: Angular served behind the gateway
  proxy.
- **Persistence**: PostgreSQL via Prisma, one schema per owning service
  (`public` for expense, `notifications` for notifications).
- **Messaging**: RabbitMQ with durable queues for commands and events.
- **Durable workflows**: self-hosted Temporal (server + UI in `infra/docker-compose.yml`,
  persisting to the shared PostgreSQL instance). Workflows orchestrate timing only; state
  mutations remain commands in the owning service, and side effects still flow through the
  outbox (Principles I and III). Managed workflow SaaS is not part of the stack.
- **Identity**: Keycloak; roles decide capabilities (approvers cannot create
  requests).
- **Email**: providers implement the `EmailProvider` interface; local development
  uses Mailpit over SMTP. Vendor SDKs never leak into templates or business logic.
- Local development MUST work with `infra/docker-compose.yml` plus the documented
  `pnpm` scripts alone; no undocumented external dependencies.

## Development Workflow & Quality Gates

- Work happens on feature branches (e.g. `feat/...`) merged via pull request into
  `develop`, then `master`. Direct pushes to `master` are forbidden.
- A pull request MUST pass lint and `pnpm test:all`, and reviewers MUST verify
  compliance with the Core Principles — especially service ownership (I) and
  outbox/idempotency rules (III) for anything touching messaging.
- Database migrations ship in the same PR as the code that requires them, and are
  backward compatible with the previously deployed release whenever feasible.
- `README.md` and `docs/` are updated in the same PR when setup steps, ports,
  accounts, or service responsibilities change.
- Deviations from any principle require a written justification in the PR
  description; unjustified deviations are grounds for rejection.

## Governance

This constitution supersedes ad-hoc practice for the Approvia workspace. When
guidance elsewhere (docs, comments, habit) conflicts with it, the constitution
wins until amended.

- **Amendments**: proposed via pull request modifying this file, including a Sync
  Impact Report and a version bump. Approval by a project maintainer is required;
  amendments that loosen a NON-NEGOTIABLE principle require explicit justification
  and a migration plan for existing code.
- **Versioning**: semantic versioning. MAJOR for removals or backward-incompatible
  redefinitions of principles; MINOR for new principles or materially expanded
  guidance; PATCH for clarifications and wording fixes.
- **Compliance review**: every pull request review checks the change against the
  Core Principles; the quality gates in Development Workflow are the enforcement
  mechanism. Complexity beyond what a principle allows MUST be justified in
  writing or simplified.

**Version**: 1.1.0 | **Ratified**: 2026-08-24 | **Last Amended**: 2026-08-24
