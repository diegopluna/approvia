# Phase 0 Research: Durable Approval Workflows

All Technical Context unknowns are resolved below. Each entry: Decision / Rationale /
Alternatives considered.

## R1. Durable-workflow engine

- **Decision**: Self-hosted **Temporal** — `temporalio/auto-setup` + `temporalio/ui` added to
  `infra/docker-compose.yml`, persisting to the existing `postgres:17` container (databases
  `temporal` and `temporal_visibility`, created by auto-setup). Host ports: 7233 (gRPC),
  8233 → UI (8080 is taken by Keycloak).
- **Rationale**: Product-owner decision (2026-08-24) after explicit comparison. Durability is
  identical across candidates — state persisted, missed timers fire exactly once on recovery —
  because a cloud scheduler cannot act while our own effectors (expense DB, notifications, SMTP)
  are down anyway. Temporal self-hosted is the only candidate that preserves the constitution's
  offline-local-dev rule with a small footprint (2 compose services, reused Postgres), and its
  timer + signal model maps 1:1 onto reminders/deadline/decision.
- **Alternatives considered**: **trigger.dev Cloud** — better DX, but dev/CI need internet + API
  keys (breaks offline local dev) and adds an external SaaS to the critical path.
  **trigger.dev self-hosted** — offline-capable but ~6 extra services (webapp, supervisor, Redis,
  ClickHouse, MinIO, registry). **Bespoke Postgres scheduler** (poller mirroring
  `outbox.publisher.ts`) — smallest footprint, no amendment needed; declined by product owner in
  favor of a real workflow engine (growth toward multi-step chains, free timer/retry/observability).

## R2. Where the workflow code runs

- **Decision**: Inside the **expense service** (`apps/expense/src/app/workflows/`): workflow
  definition, activities, worker bootstrap, and a lifecycle consumer. Worker start is env-gated
  (`WORKFLOWS_ENABLED=false` skips it, mirroring `OUTBOX_PUBLISHER_ENABLED`).
- **Rationale**: Constitution I — the approval lifecycle is expense-owned; activities call
  expense-service methods in-process, so no new internal API surface and no second writer.
  One fewer deployable than a dedicated worker app.
- **Alternatives considered**: A separate `apps/workflows` worker app — cleaner process isolation,
  but needs an internal command API into expense (new surface, new authz) or shared DB access
  (forbidden). Rejected for v1.

## R3. Starting and signalling workflows reliably

- **Decision**: Drive Temporal from the **existing outbox-published events**. The expense service
  binds a new durable queue `expense.workflows` to the `approvia.events` exchange for
  `expense.request.created.v1` / `approved.v1` / `rejected.v1`. On `created` → `start`
  `approvalWorkflow` with workflow ID `approval-<requestId>`; on `approved`/`rejected` → signal
  `decided`. Messages are acked only after the Temporal call succeeds; "workflow already
  started" / signal-to-completed-workflow are treated as success (idempotent replay).
- **Rationale**: Constitution III. Starting a workflow inline after the HTTP commit could be lost
  in a crash between commit and start; the outbox already guarantees at-least-once delivery of
  exactly these lifecycle facts. Deterministic workflow IDs make redelivery a no-op.
- **Alternatives considered**: Inline start post-commit with retry (lossy window); a second outbox
  poller writing to Temporal directly (duplicates outbox mechanics for no gain).

## R4. Expiry semantics and the decision-vs-expiry race

- **Decision**: The `expireRequest` activity calls an expense-service command that runs one
  transaction: `updateMany WHERE id = ? AND status = 'PENDING'` → `EXPIRED` (+`expired_at`); if 0
  rows, the request was already decided → no-op success. When the update wins, the same
  transaction writes the `expense.request.expired.v1` outbox event and a `request_activities`
  row. Approve/reject commands symmetrically guard on `status = 'PENDING'` and return a conflict
  ("request expired") otherwise.
- **Rationale**: FR-007 — "whichever is durably recorded first wins" reduces to a conditional
  update; no distributed coordination needed. Activity retries are safe (0-row no-op).
- **Alternatives considered**: Optimistic locking with a version column (more moving parts, same
  guarantee); resolving the race inside the workflow (workflow can't see DB truth — wrong layer).

## R5. Exactly-once effect for reminder/expiry emails

- **Decision**: Deterministic event IDs — `eventId = uuidv5(namespace, "<requestId>:reminder:<n>")`
  for reminder occurrence *n*, and `uuidv5(namespace, "<requestId>:expired")`. The notifications
  service's existing unique constraint `(eventId, recipient, template, templateVersion)` then
  dedupes end-to-end even if an activity retry double-writes the outbox row.
- **Rationale**: FR-009 / SC-002 without new infrastructure: the dedupe already exists in
  `EmailDelivery`; determinism just lets retries collide with it. The `recordReminder` command
  additionally guards with a unique `(request_id, kind, occurrence)` index on
  `request_activities`, skipping the outbox write when the occurrence was already recorded.
- **Alternatives considered**: A dedupe-key column on `outbox_events` (works, but duplicates the
  guarantee the delivery table already provides); relying on Temporal's at-most-once activity
  scheduling (not a guarantee under worker crash between side effect and completion).

## R6. Schedule configuration and per-request pinning

- **Decision**: Env-configured, read at submission time: `APPROVAL_DECISION_TTL_HOURS` (default
  120 = 5 days), `APPROVAL_REMINDER_DELAY_HOURS` (default 24), `APPROVAL_REMINDER_INTERVAL_HOURS`
  (default 24). The computed `decision_deadline_at` is stored on the request row, and the
  reminder delays are passed as **workflow input**, so config changes affect only requests
  submitted afterwards (FR-012). Low values (minutes) supported for local validation.
- **Rationale**: FR-001/FR-012; pinning inputs at start is the standard Temporal pattern for
  "in-flight requests keep their schedule".
- **Alternatives considered**: Reading config inside activities (config change would retroactively
  reshape in-flight schedules — violates FR-012); a settings table (overkill for v1's
  system-wide-only knobs).

## R7. Automated-action history (FR-011)

- **Decision**: New `request_activities` table in the expense schema, written in the same
  transaction as the corresponding outbox event (`REMINDER_SENT` with occurrence number,
  `EXPIRED`). Exposed on the existing request-detail response and rendered as a history list in
  the frontend.
- **Rationale**: Constitution V (owning service enforces invariants); querying Temporal for
  history would couple read paths to the engine and violate ownership boundaries.
- **Alternatives considered**: Deriving history from `outbox_events` (retention/shape not meant
  for display); Temporal UI as the history (operator tool, not user-facing).

## R8. Testing strategy

- **Decision**: `@temporalio/testing` `TestWorkflowEnvironment.createTimeSkipping()` for workflow
  unit tests (reminder cadence, deadline firing, signal cancels timers) with mocked activities;
  Jest unit tests for new event parsers (`packages/events`) and notification templates; expense
  service command tests for the conditional expiry and idempotent `recordReminder`; gateway-e2e
  scenario for deciding an expired request (expects 409). Local end-to-end validation via
  minute-scale env values (see quickstart.md).
- **Rationale**: Constitution IV — the seams (contracts, race, idempotency) get integration-grade
  coverage; time-skipping keeps workflow tests fast and deterministic.
- **Alternatives considered**: Real-time workflow tests (slow, flaky); skipping workflow tests in
  `test:all` (violates the merge gate).
