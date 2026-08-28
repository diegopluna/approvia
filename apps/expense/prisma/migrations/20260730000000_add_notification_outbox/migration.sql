ALTER TABLE "purchase_requests"
ADD COLUMN "requester_email" VARCHAR(320);

CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "event_name" VARCHAR(120) NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "processing_at" TIMESTAMPTZ(3),

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "outbox_events_published_at_occurred_at_idx"
ON "outbox_events"("published_at", "occurred_at");
