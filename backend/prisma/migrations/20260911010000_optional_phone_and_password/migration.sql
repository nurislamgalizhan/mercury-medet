-- Clients registered at the desk may have neither a phone number nor a way to
-- sign in yet. Both become optional; the unique index on phone still holds for
-- the rows that do have one, because Postgres allows repeated NULLs.
ALTER TABLE "users" ALTER COLUMN "phone" DROP NOT NULL;
ALTER TABLE "users" ALTER COLUMN "passwordHash" DROP NOT NULL;

ALTER TYPE "AdminActionType"
  ADD VALUE IF NOT EXISTS 'CLIENT_PASSWORD_ISSUED';
