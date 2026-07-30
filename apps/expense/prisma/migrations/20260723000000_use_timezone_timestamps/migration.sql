ALTER TABLE "purchase_requests"
ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(3)
USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "decided_at" TYPE TIMESTAMPTZ(3)
USING "decided_at" AT TIME ZONE 'UTC';
