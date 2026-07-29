ALTER TYPE "AdminActionType" ADD VALUE IF NOT EXISTS 'CLIENT_VERIFIED_BY_ADMIN';
ALTER TYPE "AdminActionType" ADD VALUE IF NOT EXISTS 'CLIENT_VERIFICATION_REQUEST_DELETED';
ALTER TYPE "AdminActionType" ADD VALUE IF NOT EXISTS 'CLIENT_PASSWORD_RESET';

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "tokenVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "registrationStatusTokenHash" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "users_registrationStatusTokenHash_key"
  ON "users"("registrationStatusTokenHash");

ALTER TABLE "registration_attempts"
  ADD COLUMN IF NOT EXISTS "statusTokenHash" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "registration_attempts_statusTokenHash_key"
  ON "registration_attempts"("statusTokenHash");

CREATE TABLE IF NOT EXISTS "admin_verification_requests" (
  "id" SERIAL NOT NULL,
  "phone" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  "statusTokenHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_verification_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "admin_verification_requests_statusTokenHash_key"
  ON "admin_verification_requests"("statusTokenHash");
CREATE INDEX IF NOT EXISTS "admin_verification_requests_phone_createdAt_idx"
  ON "admin_verification_requests"("phone", "createdAt");
CREATE INDEX IF NOT EXISTS "admin_verification_requests_createdAt_idx"
  ON "admin_verification_requests"("createdAt");
