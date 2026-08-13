ALTER TABLE "purchase_requests" ADD COLUMN "idempotency_key" VARCHAR(255);

CREATE UNIQUE INDEX "purchase_requests_requester_id_idempotency_key_key"
ON "purchase_requests"("requester_id", "idempotency_key");
