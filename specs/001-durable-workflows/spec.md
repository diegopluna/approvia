# Feature Specification: Durable Approval Workflows

**Feature Branch**: `001-durable-workflows`

**Created**: 2026-08-24

**Status**: Draft

**Input**: User description: "Durable Workflows — automated, long-running follow-up on purchase
requests (candidate platform: trigger.dev). Confirmed v1 scope: approver reminders and a decision
deadline (SLA) with auto-expiry of undecided requests."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Approvers are reminded of pending requests (Priority: P1)

A requester submits a purchase request and no approver acts on it. After a defined waiting period,
every eligible approver receives a reminder email pointing to the pending request. Reminders repeat
on a fixed cadence until someone approves or rejects the request (or it expires). As soon as a
decision is recorded, no further reminders are sent.

**Why this priority**: Stalled requests are the core pain this feature addresses. Reminders alone
already deliver value (faster decisions) without any change to request states, making this the
smallest viable slice.

**Independent Test**: Submit a request, let the reminder waiting period elapse, and verify each
eligible approver receives exactly one reminder email per scheduled occurrence; record a decision
and verify no further reminders arrive.

**Acceptance Scenarios**:

1. **Given** a request has been pending for the reminder waiting period, **When** the reminder
   moment is reached, **Then** every eligible approver receives one reminder email identifying the
   request, its amount, and its requester.
2. **Given** a request remains pending after a reminder, **When** the next cadence interval
   elapses, **Then** approvers receive the next reminder (one per approver per occurrence, never
   duplicates).
3. **Given** a request is approved or rejected, **When** the next reminder would otherwise be due,
   **Then** no reminder is sent.

---

### User Story 2 - Undecided requests expire at their deadline (Priority: P2)

Every request receives a decision deadline when it is submitted. If no decision is recorded by the
deadline, the request automatically transitions to an Expired state: approvers can no longer decide
it, the requester is notified that it expired, and the requester may submit a new request if the
purchase is still needed.

**Why this priority**: Auto-expiry keeps the approval queue honest — nothing lingers forever — but
it depends on the same scheduling foundation as reminders and changes the request lifecycle, so it
builds on User Story 1.

**Independent Test**: Submit a request, let its deadline pass with no decision, and verify the
request shows as Expired, the requester received an expiry notification, and approve/reject
attempts are refused.

**Acceptance Scenarios**:

1. **Given** a request is pending and its deadline passes with no decision, **When** the deadline
   is reached, **Then** the request transitions to Expired and the requester receives an expiry
   notification.
2. **Given** a request has expired, **When** an approver attempts to approve or reject it, **Then**
   the action is refused with a clear message that the request expired.
3. **Given** a request was approved or rejected before its deadline, **When** the deadline passes,
   **Then** the request keeps its decision and no expiry occurs.
4. **Given** a decision and the expiry moment coincide, **When** both are processed, **Then** a
   decision recorded before the expiry takes effect always wins, and an expired request is never
   silently converted back to pending or to a decided state.

---

### User Story 3 - Deadline and automated activity are visible (Priority: P3)

Requesters and approvers can see each request's decision deadline and current state, including
Expired. The request's history shows what the system did automatically — when reminders were sent
and when the request expired — so nobody has to guess why an email arrived or why a request closed.

**Why this priority**: Transparency makes the automation trustworthy, but reminders and expiry
function correctly without it.

**Independent Test**: Open a request as its requester and as an approver and verify the deadline is
displayed; after a reminder and an expiry have occurred, verify both appear in the request's
history with timestamps.

**Acceptance Scenarios**:

1. **Given** a pending request, **When** the requester or an approver views it, **Then** its
   decision deadline is displayed.
2. **Given** reminders have been sent or the request has expired, **When** anyone with access views
   the request, **Then** those automated actions appear in its history with timestamps.

---

### Edge Cases

- Decision vs. expiry race: a decision recorded before the expiry takes effect must win; expiry
  must never overwrite a recorded decision, and a decision must never be accepted on an already
  expired request.
- Outage at a scheduled moment: if the system is down (or the scheduler unreachable) when a
  reminder or expiry is due, the action must still happen after recovery — late, but exactly once,
  and never lost.
- Duplicate scheduling or redelivery: an approver must never receive two reminder emails for the
  same scheduled occurrence, and a request must never be expired twice.
- Reminder due after expiry: once a request expires, pending reminder occurrences are cancelled.
- Approver set changes between occurrences: each reminder occurrence goes to the approvers eligible
  at send time.
- Configuration change: changing the default deadline or reminder cadence affects only requests
  submitted after the change; in-flight requests keep the schedule they were created with.
- Expired request follow-up: an expired request cannot be reopened; the requester submits a new
  request, which receives a fresh deadline.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST assign every purchase request a decision deadline at submission time,
  derived from a system-wide configured duration (default: 5 calendar days).
- **FR-002**: System MUST send a reminder email to every eligible approver when a request has been
  pending for the configured waiting period (default: 24 hours), and repeat on the configured
  cadence (default: every 24 hours) until the request is decided or expired.
- **FR-003**: System MUST stop all future reminders for a request immediately once it is approved,
  rejected, or expired.
- **FR-004**: System MUST automatically transition a request that reaches its deadline with no
  recorded decision to an Expired state.
- **FR-005**: System MUST notify the requester by email when their request expires, including the
  request details and the fact that a new request must be submitted if still needed.
- **FR-006**: System MUST refuse approve and reject actions on an expired request and tell the
  approver why the action was refused.
- **FR-007**: System MUST never expire a request that already has a recorded decision; when a
  decision and expiry coincide, whichever is durably recorded first wins and the other is
  discarded.
- **FR-008**: Scheduled actions (reminders, expiry) MUST survive process restarts and temporary
  outages: an action whose moment passed during downtime executes after recovery rather than being
  lost.
- **FR-009**: Each scheduled occurrence MUST have at-most-once effect: no duplicate reminder emails
  for the same occurrence and recipient, and no double expiry, even under retries or redelivery.
- **FR-010**: System MUST display each request's decision deadline and Expired state to its
  requester and to approvers wherever the request is viewed.
- **FR-011**: System MUST record automated actions (each reminder occurrence sent, expiry applied)
  in the request's history with timestamps.
- **FR-012**: Deadline duration, reminder waiting period, and reminder cadence MUST be configurable
  system-wide by operators; changes apply only to requests submitted after the change.

### Key Entities

- **Purchase Request**: existing entity, extended with a decision deadline and a new terminal
  Expired state alongside approved and rejected. An expired request keeps its data for history but
  accepts no further decisions.
- **Workflow Schedule**: the per-request plan of automated moments — reminder occurrences and the
  expiry moment — including which occurrences have already taken effect, so completed occurrences
  are never repeated. (Realized by the durable-workflow engine's own state, not application data —
  see data-model.md.)
- **Automated Action Record**: history entry describing something the system did on its own
  (reminder sent to given approvers, request expired), with timestamp, tied to the request.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of requests still undecided at their deadline are marked Expired and their
  requester notified within 5 minutes of the deadline.
- **SC-002**: 100% of due reminder occurrences result in exactly one email per eligible approver,
  delivered within 15 minutes of the scheduled moment; zero duplicate reminders per occurrence.
- **SC-003**: Zero reminder emails are sent for requests that are already decided or expired.
- **SC-004**: After a system outage spanning scheduled moments, 100% of the missed reminders and
  expiries take effect within 10 minutes of recovery, each exactly once.
- **SC-005**: Users can determine a request's deadline and why it closed (decision vs. expiry) from
  the request view alone, without contacting support.
- **SC-006**: Zero requests remain in the pending state past their deadline plus 5 minutes.

## Assumptions

- The existing single-step decision model (pending → approved/rejected) is unchanged except for the
  added Expired terminal state; multi-step approval chains and recurring scheduled requests are out
  of scope for v1.
- Overdue handling is auto-expiry (per product decision): there is no separate escalation path or
  escalation contact in v1.
- Reminder and expiry emails reuse the existing notification capability and its recipient rules
  (eligible approvers for approver-facing mail, the requester for requester-facing mail).
- Defaults — 5 calendar days to decide, first reminder after 24 hours, then every 24 hours — are
  reasonable starting values; operators can change them system-wide (FR-012). Per-request or
  per-team overrides are out of scope for v1.
- Calendar days are used (no business-day calendar or holiday awareness in v1).
- An expired request is not resubmittable in place; the requester creates a new request. A
  one-click "resubmit as new" convenience is out of scope for v1.
- A managed workflow platform (candidate: trigger.dev) is under consideration for the durable
  scheduling foundation; the choice of platform is a planning-phase decision and does not change
  the behavior specified here.
