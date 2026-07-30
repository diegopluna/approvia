# Notifications module plan

## Scope

The first release sends transactional email for these events:

- `expense.request.created`: notify eligible approvers.
- `expense.request.approved`: notify the requester.
- `expense.request.rejected`: notify the requester and include the decision
  comment.

Email must not delay or determine the outcome of an expense command. Delivery is
at least once, with idempotency in the notification service.

## Architecture

Create a dedicated `notifications` NestJS application with a
`NotificationsModule`. It consumes events from a durable
`notifications.email` RabbitMQ queue and does not expose a public HTTP API.

The expense service writes an outbox record in the same database transaction as
the purchase-request change. An expense outbox publisher sends unpublished
records to RabbitMQ and marks them published. This prevents a successful
purchase-request update from losing its notification when the broker is
temporarily unavailable.

The notification consumer validates the event, creates one delivery record per
recipient, sends through an `EmailProvider` interface, and acknowledges the
RabbitMQ message only after delivery state is persisted. A unique constraint on
`eventId`, `recipient`, and `template` makes redelivery safe.

## Event contracts

Version event names from the beginning:

```text
expense.request.created.v1
expense.request.approved.v1
expense.request.rejected.v1
```

Each envelope contains `eventId`, `eventName`, `occurredAt`, `requestId`, and the
minimum template data. Do not put access tokens or provider credentials in an
event.

The requester email must be captured from the authenticated identity when the
request is created and persisted with the request. Approver recipient discovery
needs an explicit source of truth before implementation: either a Keycloak
service account that reads members of the approver role, or a maintained
application user directory. A configured shared approver mailbox is acceptable
only as an initial product decision.

## Email delivery

Define an `EmailProvider` interface so production can use SES, Postmark, or
Resend without coupling templates to a vendor. Add Mailpit to local Compose for
SMTP capture and use an SMTP provider adapter in development.

Start with code-owned, typed HTML and plain-text templates. Every message needs
a stable template key and version, subject, recipient, locale, and correlation
metadata. Provider API keys remain environment secrets.

## Reliability

- Use a durable queue, persistent messages, manual acknowledgement, and a
  bounded prefetch count.
- Retry transient provider failures with delayed queues and exponential
  backoff.
- Route permanent failures and exhausted retries to
  `notifications.email.dead-letter`.
- Store status, attempts, last error, provider message ID, and timestamps for
  each delivery.
- Redact recipient details and message bodies from normal logs.
- Emit metrics for queue depth, send duration, success, retry, and dead-letter
  counts.

## Delivery order

1. Define and test versioned event schemas in a shared contracts library.
2. Add requester email and outbox tables to the expense database.
3. Publish expense lifecycle events from the outbox worker.
4. Generate the notifications application and its delivery persistence.
5. Add Mailpit locally and implement the SMTP adapter and three templates.
6. Add retry and dead-letter topology with manual acknowledgements.
7. Add integration tests for idempotency, retries, and malformed events.
8. Select the production email provider and approver-recipient source.

## Acceptance criteria

- Expense commands succeed when email or RabbitMQ is unavailable.
- Every committed event is eventually published after recovery.
- Redelivering the same event does not send duplicate email.
- Invalid events and permanent failures are observable and dead-lettered.
- Local emails are inspectable in Mailpit without external credentials.
- No secrets or authentication tokens are persisted in events or logs.
