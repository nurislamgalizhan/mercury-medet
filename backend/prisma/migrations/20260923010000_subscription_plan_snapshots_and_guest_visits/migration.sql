-- Tariff settings are used only for future sales. Every sold subscription stores
-- its own plan snapshot, so a later tariff edit cannot rewrite active access.
ALTER TABLE "tariffs"
  ADD COLUMN "freezeDaysAllowed" INTEGER NOT NULL DEFAULT 15,
  ADD COLUMN "guestVisitsAllowed" INTEGER NOT NULL DEFAULT 0;

-- Preserve the previous section-level allowance as the initial tariff setting.
UPDATE "tariffs" AS t
SET "freezeDaysAllowed" = s."freezeDaysAllowed"
FROM "sections" AS s
WHERE s."id" = t."sectionId";

ALTER TABLE "user_subscriptions"
  ADD COLUMN "tariffName" TEXT,
  ADD COLUMN "visitsAmount" INTEGER,
  ADD COLUMN "tariffDurationDays" INTEGER,
  ADD COLUMN "timeType" "TimeType" NOT NULL DEFAULT 'ANY',
  ADD COLUMN "timeStart" TEXT,
  ADD COLUMN "timeEnd" TEXT,
  ADD COLUMN "guestVisitsTotal" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "guestVisitsRemaining" INTEGER NOT NULL DEFAULT 0;

-- Existing customers keep the terms that were active at this deployment.
-- Guest access starts only on subscriptions sold after the setting is enabled.
UPDATE "user_subscriptions" AS us
SET
  "tariffName" = t."name",
  "visitsAmount" = t."visitsAmount",
  "tariffDurationDays" = t."durationDays",
  "timeType" = t."timeType",
  "timeStart" = t."timeStart",
  "timeEnd" = t."timeEnd"
FROM "tariffs" AS t
WHERE t."id" = us."tariffId";
