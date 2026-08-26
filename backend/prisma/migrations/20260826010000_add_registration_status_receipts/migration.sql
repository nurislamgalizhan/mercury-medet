CREATE TABLE "registration_status_receipts" (
  "id" SERIAL NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "userId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "registration_status_receipts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "registration_status_receipts_tokenHash_key"
  ON "registration_status_receipts"("tokenHash");

CREATE INDEX "registration_status_receipts_userId_idx"
  ON "registration_status_receipts"("userId");

CREATE INDEX "registration_status_receipts_createdAt_idx"
  ON "registration_status_receipts"("createdAt");

ALTER TABLE "registration_status_receipts"
  ADD CONSTRAINT "registration_status_receipts_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
