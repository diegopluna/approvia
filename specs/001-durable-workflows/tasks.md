# Tasks: Durable Approval Workflows

**Input**: Design documents from `/specs/001-durable-workflows/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included — Constitution IV makes `pnpm test:all` the merge gate, and the contracts
(race, idempotency, cadence) require integration-grade coverage.

**Organization**: Tasks are grouped by user story so each story is an independently testable
increment. US1 = approver reminders, US2 = auto-expiry, US3 = visibility.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1 / US2 / US3 (user story phases only)

## Path Conventions

Nx monorepo: services in `apps/<name>/src/app/`, shared contracts in `packages/events/src/`,
infra in `infra/`, per-service Prisma schema in `apps/<name>/prisma/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Temporal infrastructure and dependencies available locally, offline.

- [ ] T001 Add `temporal` (image `temporalio/auto-setup`, depends_on database, env `DB=postgres12`, `POSTGRES_SEEDS=database`, approvia credentials, host port `7233`) and `temporal-ui` (image `temporalio/ui`, host port `8233`) services to `infra/docker-compose.yml`; verify `docker compose -f infra/docker-compose.yml up -d --wait` succeeds and the UI answers on http://localhost:8233
- [ ] T002 Add `@temporalio/client`, `@temporalio/worker`, `@temporalio/workflow`, `@temporalio/activity`, `@temporalio/testing` to root `package.json` (and any needed `onlyBuiltDependencies`/overrides entries in `pnpm-workspace.yaml`, matching how prior native deps were handled); run `pnpm install`
- [ ] T003 [P] Create `apps/expense/src/app/workflows/workflow.config.ts` reading `APPROVAL_DECISION_TTL_HOURS` (default 120), `APPROVAL_REMINDER_DELAY_HOURS` (default 24), `APPROVAL_REMINDER_INTERVAL_HOURS` (default 24), `TEMPORAL_ADDRESS` (default `localhost:7233`), `WORKFLOWS_ENABLED` (default true), exporting typed accessors (fractional hours allowed for fast-clock local validation per quickstart.md)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, contracts, and workflow plumbing every story depends on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T004 Extend `apps/expense/prisma/schema.prisma` per data-model.md: add `EXPIRED` to `PurchaseRequestStatus`; add `decisionDeadlineAt` (`decision_deadline_at`, timestamptz(3), nullable) and `expiredAt` (`expired_at`, timestamptz(3), nullable) to `PurchaseRequest`; add `RequestActivity` model (`request_activities`, kind enum `REMINDER_SENT`/`EXPIRED`, nullable `occurrence`, `details` Json, `@@unique([requestId, kind, occurrence])`, `@@index([requestId, occurredAt])`); run `pnpm expense:db:migrate` to generate the migration
- [ ] T005 Extend `packages/events/src/index.ts` per contracts/events.md: add `reminder`/`expired` keys to `EXPENSE_EVENT_NAMES`, types `ExpenseRequestReminderEvent` and `ExpenseRequestExpiredEvent`, extend the `ExpenseIntegrationEvent` union and `parseExpenseIntegrationEvent`, and export a `deterministicEventId(seed: string)` helper (UUIDv5, fixed namespace) used for `<requestId>:reminder:<n>` and `<requestId>:expired`
- [ ] T006 [P] Add contract tests in `packages/events/src/index.spec.ts`: parse valid reminder/expired envelopes, reject malformed shapes (missing occurrence, bad deadline), and assert `deterministicEventId` stability across calls
- [ ] T007 Set `decisionDeadlineAt = createdAt + APPROVAL_DECISION_TTL_HOURS` when creating a request in `apps/expense/src/app/expense.service.ts` (using T003 config); include `decisionDeadlineAt` in the created-request return value
- [ ] T008 Create `apps/expense/src/app/workflows/approval.workflow.ts`: `approvalWorkflow` with input `{requestId, decisionDeadlineAt, reminderDelayMs, reminderIntervalMs}` and a `decided` signal that completes the workflow and cancels pending timers (deterministic code only — Temporal time APIs, activities proxied via `proxyActivities`); reminder/deadline branches land in US1/US2
- [ ] T009 Create `apps/expense/src/app/workflows/workflow.worker.ts`: NestJS-lifecycle-managed Temporal worker on task queue `approval-lifecycle` (bundled workflow code, activities injected), skipped when `WORKFLOWS_ENABLED=false`; register it plus an exported Temporal client provider in `apps/expense/src/app/expense.module.ts`
- [ ] T010 Create `apps/expense/src/app/workflows/lifecycle.consumer.ts`: bind durable queue `expense.workflows` to exchange `approvia.events` for `expense.request.created.v1|approved.v1|rejected.v1` (amqp-connection-manager, mirroring `outbox.publisher.ts` connection handling); on created → start `approvalWorkflow` with workflow ID `approval-<requestId>` (WorkflowExecutionAlreadyStarted = success), on approved/rejected → signal `decided` (not-found/completed = success); ack only after the Temporal call succeeds

**Checkpoint**: Foundation ready — schema migrated, contracts published, workflows start and
complete on decisions (no timers acting yet).

---

## Phase 3: User Story 1 - Approvers are reminded of pending requests (Priority: P1) 🎯 MVP

**Goal**: Pending requests trigger repeating reminder emails to eligible approvers that stop the
moment a decision lands — exactly one email per approver per occurrence.

**Independent Test**: Quickstart Scenario 1 — submit a request under fast-clock config, observe
one `approver-reminder` email per approver per occurrence in Mailpit and `REMINDER_SENT` history
rows; approve, observe no further reminders.

### Tests for User Story 1

- [ ] T011 [P] [US1] Workflow tests in `apps/expense/src/app/workflows/approval.workflow.spec.ts` using `TestWorkflowEnvironment.createTimeSkipping()` with mocked activities: reminder fires after `reminderDelayMs` then every `reminderIntervalMs` with occurrences 1,2,3…; `decided` signal before first reminder → zero activity calls; `decided` mid-stream → no further calls
- [ ] T012 [P] [US1] Service tests in `apps/expense/src/app/expense.service.spec.ts` for `recordReminder`: pending request → inserts `request_activities(REMINDER_SENT, n)` + outbox event with `deterministicEventId('<id>:reminder:<n>')` in one transaction; duplicate occurrence → no-op, no second outbox row; non-pending request → no-op

### Implementation for User Story 1

- [ ] T013 [US1] Implement `recordReminder(requestId, occurrence)` command in `apps/expense/src/app/expense.service.ts`: single transaction — verify status `PENDING` (else no-op success), create `RequestActivity(REMINDER_SENT, occurrence)` (unique-violation → no-op success), insert `expense.request.reminder.v1` outbox event with payload per contracts/events.md (snapshot + occurrence + decisionDeadlineAt); set the outbox **row id** to the deterministic eventId so row id, AMQP `messageId`, and payload `eventId` all agree
- [ ] T014 [US1] Create `apps/expense/src/app/workflows/activities.ts` with `sendReminder(requestId, occurrence)` delegating to `recordReminder`, non-retryable on validation errors; wire into the worker's activity registration in `apps/expense/src/app/workflows/workflow.worker.ts`
- [ ] T015 [US1] Implement the reminder loop in `apps/expense/src/app/workflows/approval.workflow.ts`: wait `reminderDelayMs` (or `decided`), then on each tick before `decisionDeadlineAt` call `sendReminder` with the next occurrence and wait `reminderIntervalMs`; `decided` cancels the loop
- [ ] T016 [P] [US1] Add `approver-reminder` template (v1) to `apps/notifications/src/app/email-template.service.ts`: request title/amount (BRL from centavos)/requester, occurrence number, decision deadline, link text to the pending request
- [ ] T017 [US1] Extend `apps/notifications/src/app/notifications.consumer.ts` to bind routing key `expense.request.reminder.v1` on queue `notifications.email`, resolve eligible approvers via `keycloak-recipient.service.ts` (same rule as created.v1), and create one delivery per approver (existing `(eventId, recipient, template, templateVersion)` dedupe applies)
- [ ] T018 [P] [US1] Add notifications tests in `apps/notifications/src/app/notifications.spec.ts`: reminder event → one delivery per approver with `approver-reminder` template; redelivered reminder event (same deterministic eventId) → no duplicate deliveries

**Checkpoint**: User Story 1 fully functional — run quickstart Scenario 1 end-to-end.

---

## Phase 4: User Story 2 - Undecided requests expire at their deadline (Priority: P2)

**Goal**: Requests reaching their deadline undecided transition to terminal `EXPIRED`, the
requester is emailed, further decisions are refused, and a recorded decision always beats expiry.

**Independent Test**: Quickstart Scenarios 2–3 — let a request pass its fast-clock deadline:
Expired badge state, requester email, 409 on decision attempts; approve another just before the
deadline: stays Approved, no expiry artifacts.

### Tests for User Story 2

- [ ] T019 [P] [US2] Extend `apps/expense/src/app/workflows/approval.workflow.spec.ts`: undecided at `decisionDeadlineAt` → exactly one `expireRequest` call, then workflow completes and no reminder fires after the deadline; `decided` signal just before deadline → `expireRequest` never called
- [ ] T020 [P] [US2] Extend `apps/expense/src/app/expense.service.spec.ts` for `expireRequest`: pending → status `EXPIRED` + `expiredAt` + `expense.request.expired.v1` outbox (deterministic eventId) + `RequestActivity(EXPIRED)` in one transaction; already-decided → 0-row no-op with no side effects; repeated call → no-op; and for decisions: approve/reject on `EXPIRED`/decided request → conflict error, no state change

### Implementation for User Story 2

- [ ] T021 [US2] Implement `expireRequest(requestId)` command in `apps/expense/src/app/expense.service.ts`: single transaction — `updateMany({where: {id, status: PENDING}, data: {status: EXPIRED, expiredAt: now}})`; if 0 rows → no-op success; else insert `expense.request.expired.v1` outbox event (outbox row id = deterministic eventId, payload per contracts/events.md) and `RequestActivity(EXPIRED)`. If `requesterEmail` is null (defensive — should not occur for workflow-managed requests), still expire and record history but skip the outbox event and log a warning
- [ ] T022 [US2] Guard approve/reject in `apps/expense/src/app/expense.service.ts` with the same conditional-update pattern: 0 rows updated → throw a conflict error carrying code `REQUEST_NOT_PENDING`, with message "expired on <date>" when status is `EXPIRED` and "already approved/rejected" when a decision exists (per contracts/http.md)
- [ ] T023 [US2] Add `expireRequest(requestId)` activity to `apps/expense/src/app/workflows/activities.ts` (delegating to the command) and implement the deadline branch in `apps/expense/src/app/workflows/approval.workflow.ts`: at `decisionDeadlineAt` without `decided`, call `expireRequest` then complete; ensure no reminder ever fires past the deadline
- [ ] T024 [US2] Propagate the conflict through `apps/gateway/src/app/` decision endpoints as HTTP 409 with `{code: "REQUEST_NOT_PENDING", message}` per contracts/http.md (map the expense-service error in the gateway's RPC error handling)
- [ ] T025 [P] [US2] Add `requester-expired` template (v1) to `apps/notifications/src/app/email-template.service.ts` (deadline date, request details, "submit a new request if still needed") and bind routing key `expense.request.expired.v1` in `apps/notifications/src/app/notifications.consumer.ts` routing to `request.requesterEmail`; treat a missing/empty recipient as a handled no-delivery case (log + ack), not a crash
- [ ] T026 [P] [US2] Extend `apps/notifications/src/app/notifications.spec.ts`: expired event → single delivery to requester with `requester-expired` template; redelivery → deduped
- [ ] T027 [US2] Add gateway-e2e scenario in `apps/gateway-e2e/src/`: create a request through the API, then set it to `EXPIRED` by direct database update (same DB access pattern the e2e suite's setup uses — do NOT add a test-only endpoint); approver decision attempt → 409 with code `REQUEST_NOT_PENDING`

**Checkpoint**: Stories 1 AND 2 work — run quickstart Scenarios 2–4 (including the
outage-recovery drill).

---

## Phase 5: User Story 3 - Deadline and automated activity are visible (Priority: P3)

**Goal**: Requesters and approvers see the deadline, the Expired state, and a history of
automated actions on every request.

**Independent Test**: Quickstart Scenario 5 — deadline visible on request views for both roles;
after Scenarios 1–2, history lists each reminder occurrence and the expiry with timestamps.

### Tests for User Story 3

- [ ] T028 [P] [US3] Frontend tests in `apps/frontend/src/` (alongside existing request-view specs): deadline rendered on pending request detail; `EXPIRED` badge rendered and decision buttons absent for expired requests; history list renders `REMINDER_SENT` (with occurrence) and `EXPIRED` entries with timestamps; a 409 `REQUEST_NOT_PENDING` response to a decision renders its message and refreshes the request state

### Implementation for User Story 3

- [ ] T029 [US3] Include `decisionDeadlineAt`, `expiredAt`, and `activities` (from `RequestActivity`, ordered by `occurredAt`) in request detail — and `decisionDeadlineAt`/`status` in list responses — in `apps/expense/src/app/expense.service.ts` and `apps/expense/src/app/expense.controller.ts` per contracts/http.md
- [ ] T030 [US3] Pass the new fields through the gateway request DTOs/handlers in `apps/gateway/src/app/` unchanged (no new endpoints)
- [ ] T031 [US3] Update `apps/frontend/src/` request models/services for the new fields and render: deadline on request cards and detail (requester + approver views), `EXPIRED` as a distinct terminal badge with decision actions hidden, and the 409 conflict message surfaced with a refresh of the request state
- [ ] T032 [US3] Add a request-history section to the frontend request detail view in `apps/frontend/src/` listing automated actions ("Reminder #n sent", "Request expired") with localized timestamps

**Checkpoint**: All three stories independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T033 [P] Update `README.md`: Temporal UI console (http://localhost:8233), new env vars (`APPROVAL_DECISION_TTL_HOURS`, `APPROVAL_REMINDER_DELAY_HOURS`, `APPROVAL_REMINDER_INTERVAL_HOURS`, `TEMPORAL_ADDRESS`, `WORKFLOWS_ENABLED`), and the expiry/reminder behavior in the request-lifecycle paragraph
- [ ] T034 [P] Add `docs/durable-workflows.md` summarizing the architecture (workflow-per-request, lifecycle queue, activity idempotency, race resolution) with pointers to `specs/001-durable-workflows/`
- [ ] T035 Add expense-service tests to the merge gate: ensure an `nx test expense` target exists covering the new specs and add it to `test:all` in root `package.json` (Constitution IV)
- [ ] T036 Run full quickstart.md validation (Scenarios 1–5 under fast-clock config, including the Scenario 4 outage drill) and `pnpm test:all`; fix anything red

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none — start immediately; T001/T002 parallel, T003 anytime
- **Foundational (Phase 2)**: needs T002 (SDK) and T001 (server) for T008–T010; T004 independent
  of T001–T003; T005 → T006; T003+T004 → T007; T008 → T009 → T010
- **US1 (Phase 3)**: needs Phase 2 complete (schema, contracts, worker, lifecycle consumer)
- **US2 (Phase 4)**: needs Phase 2; independent of US1 except sharing
  `approval.workflow.ts`/`activities.ts` — coordinate edits if run in parallel
- **US3 (Phase 5)**: needs Phase 2 (fields exist after T004/T007); history entries only appear
  once US1/US2 write them, but rendering is testable with seeded data
- **Polish (Phase 6)**: after desired stories; T036 last

### User Story Dependencies

- **US1 (P1)**: Foundational only
- **US2 (P2)**: Foundational only (file-overlap coordination with US1 in
  `approval.workflow.ts`, `activities.ts`, `expense.service.ts`, `notifications.consumer.ts`)
- **US3 (P3)**: Foundational only; visually richest after US1/US2 have produced activity rows

### Within Each User Story

- Tests first (T011/T012, T019/T020, T028) and failing before implementation
- Commands/models before activities before workflow wiring; producer before consumer
- Story checkpoint (quickstart scenario) before moving on

### Parallel Opportunities

- Phase 1: T001 ∥ T002, then T003
- Phase 2: T004 ∥ T005; T006 ∥ T007 after T005
- US1: T011 ∥ T012 (tests), then T013 → T014 → T015 while T016 ∥ T018 proceed; T017 after T016
- US2: T019 ∥ T020, T025 ∥ T026 alongside T021–T024
- US3: T028 ∥ T029, then T030 → T031 → T032
- Polish: T033 ∥ T034

---

## Parallel Example: User Story 1

```bash
# Tests first, in parallel:
Task: "Workflow time-skipping tests in apps/expense/src/app/workflows/approval.workflow.spec.ts"
Task: "recordReminder service tests in apps/expense/src/app/expense.service.spec.ts"

# Then producer side sequentially (same files):
T013 recordReminder command → T014 sendReminder activity → T015 workflow reminder loop

# Consumer side in parallel with producer side:
Task: "approver-reminder template in apps/notifications/src/app/email-template.service.ts"
Task: "notifications reminder tests in apps/notifications/src/app/notifications.spec.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 (Setup) → Phase 2 (Foundational)
2. Phase 3 (US1 reminders) → validate quickstart Scenario 1 under fast-clock config
3. Deploy/demo: reminders alone already deliver the core value (unstuck approvals)

### Incremental Delivery

1. Setup + Foundational → workflows start/complete on decisions (invisible but durable)
2. +US1 → reminders live (MVP)
3. +US2 → deadlines + auto-expiry + 409 guard (run the outage drill, Scenario 4)
4. +US3 → deadline/history visibility
5. Polish → docs, merge-gate wiring, full validation

### Parallel Team Strategy

After Foundational: one developer on US1 (producer path), one on US2 (agree on
`approval.workflow.ts` structure first — it's the shared file), one on US3 (frontend/gateway,
seeded data). Merge order US1 → US2 → US3 minimizes conflicts.

---

## Notes

- Deterministic IDs are the idempotency backbone: workflow ID `approval-<requestId>`, event IDs
  `uuidv5('<requestId>:reminder:<n>' | '<requestId>:expired')` — never replace with random UUIDs;
  they double as the outbox row ids (T013/T021).
- FR-008/SC-004 (outage recovery) are provided by Temporal's durable-execution guarantee plus the
  idempotency guards, and are validated **manually only** in v1 via quickstart Scenario 4 (T036);
  there is deliberately no automated crash-recovery test. Revisit if recovery ever regresses.
- Constitution guards: only the expense service writes request state; all emails via outbox →
  RabbitMQ → notifications; contracts change in `packages/events` before producers/consumers.
- Commit after each task or logical group; every checkpoint maps to a quickstart scenario.
