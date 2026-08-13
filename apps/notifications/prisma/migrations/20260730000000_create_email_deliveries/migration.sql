CREATE TYPE "EmailDeliveryStatus" AS ENUM (
    'PENDING',
    'SENDING',
    'SENT',
    'RETRYING',
    'FAILED'
);

CREATE TABLE "email_deliveries" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "event_name" VARCHAR(120) NOT NULL,
    "recipient" VARCHAR(320) NOT NULL,
    "template" VARCHAR(120) NOT NULL,
    "template_version" INTEGER NOT NULL,
    "template_data" JSONB NOT NULL,
    "status" "EmailDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "provider_message_id" VARCHAR(255),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "sent_at" TIMESTAMPTZ(3),

    CONSTRAINT "email_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "email_deliveries_event_id_recipient_template_template_version_key"
ON "email_deliveries"("event_id", "recipient", "template", "template_version");

CREATE INDEX "email_deliveries_status_updated_at_idx"
ON "email_deliveries"("status", "updated_at");
