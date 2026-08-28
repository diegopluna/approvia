CREATE TYPE "PurchaseRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "purchase_requests" (
    "id" UUID NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "justification" VARCHAR(1000) NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'BRL',
    "status" "PurchaseRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requester_id" VARCHAR(255) NOT NULL,
    "requester_name" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by_id" VARCHAR(255),
    "decided_by_name" VARCHAR(255),
    "decision_comment" VARCHAR(1000),
    "decided_at" TIMESTAMP(3),

    CONSTRAINT "purchase_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "purchase_requests_positive_amount" CHECK ("amount_minor" > 0)
);

CREATE INDEX "purchase_requests_requester_id_created_at_idx"
ON "purchase_requests"("requester_id", "created_at");

CREATE INDEX "purchase_requests_status_created_at_idx"
ON "purchase_requests"("status", "created_at");
