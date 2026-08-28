-- CreateEnum
CREATE TYPE "RequestActivityKind" AS ENUM ('REMINDER_SENT', 'EXPIRED');

-- AlterEnum
ALTER TYPE "PurchaseRequestStatus" ADD VALUE 'EXPIRED';

-- AlterTable
ALTER TABLE "purchase_requests" ADD COLUMN     "decision_deadline_at" TIMESTAMPTZ(3),
ADD COLUMN     "expired_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "request_activities" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "kind" "RequestActivityKind" NOT NULL,
    "occurrence" INTEGER,
    "details" JSONB,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "request_activities_request_id_occurred_at_idx" ON "request_activities"("request_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "request_activities_request_id_kind_occurrence_key" ON "request_activities"("request_id", "kind", "occurrence");

-- AddForeignKey
ALTER TABLE "request_activities" ADD CONSTRAINT "request_activities_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "purchase_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
