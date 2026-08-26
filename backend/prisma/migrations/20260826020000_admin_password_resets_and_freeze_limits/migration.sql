ALTER TYPE "AdminActionType"
  ADD VALUE IF NOT EXISTS 'CLIENT_PASSWORD_RESET_REQUEST_DELETED';

ALTER TABLE "sections"
  ADD COLUMN "freezeDaysAllowed" INTEGER NOT NULL DEFAULT 15;

ALTER TABLE "user_subscriptions"
  ADD COLUMN "freezeDaysTotal" INTEGER NOT NULL DEFAULT 15;

CREATE TABLE "admin_password_reset_requests" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "phone" TEXT NOT NULL,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "admin_password_reset_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "admin_password_reset_requests_userId_key"
  ON "admin_password_reset_requests"("userId");

CREATE INDEX "admin_password_reset_requests_phone_idx"
  ON "admin_password_reset_requests"("phone");

CREATE INDEX "admin_password_reset_requests_createdAt_idx"
  ON "admin_password_reset_requests"("createdAt");

ALTER TABLE "admin_password_reset_requests"
  ADD CONSTRAINT "admin_password_reset_requests_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
