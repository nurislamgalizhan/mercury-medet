ALTER TABLE "user_subscriptions"
  ADD COLUMN "freezeStartedAt" TIMESTAMP(3),
  ADD COLUMN "freezeDaysUsed" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "freezeDaysReserved" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "freezeUntilManual" BOOLEAN NOT NULL DEFAULT false;

UPDATE "user_subscriptions"
SET "frozenUntil" = NULL
WHERE "frozenUntil" <= CURRENT_TIMESTAMP;
