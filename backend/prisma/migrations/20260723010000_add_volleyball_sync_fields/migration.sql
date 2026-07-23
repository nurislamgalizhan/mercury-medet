ALTER TYPE "AdminActionType" ADD VALUE IF NOT EXISTS 'SUBSCRIPTION_UNFROZEN';

ALTER TABLE "users" ADD COLUMN "syncMemberId" TEXT;
ALTER TABLE "tariffs" ADD COLUMN "isSyncMirror" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "visit_logs" ADD COLUMN "syncId" TEXT;
ALTER TABLE "visit_logs" ADD COLUMN "sourceSite" TEXT;
ALTER TABLE "user_subscriptions" ADD COLUMN "syncId" TEXT;
ALTER TABLE "user_subscriptions" ADD COLUMN "originSite" TEXT;
ALTER TABLE "user_subscriptions" ADD COLUMN "projectionVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "admin_action_logs" ALTER COLUMN "adminId" DROP NOT NULL;
ALTER TABLE "admin_action_logs" ADD COLUMN "syncId" TEXT;
ALTER TABLE "admin_action_logs" ADD COLUMN "sourceSite" TEXT;
ALTER TABLE "admin_action_logs" ADD COLUMN "sourceActorLabel" TEXT;

CREATE TABLE "section_memberships" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "sectionId" INTEGER NOT NULL,
  "sourceSite" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "section_memberships_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_syncMemberId_key" ON "users"("syncMemberId");
CREATE UNIQUE INDEX "visit_logs_syncId_key" ON "visit_logs"("syncId");
CREATE UNIQUE INDEX "user_subscriptions_syncId_key" ON "user_subscriptions"("syncId");
CREATE UNIQUE INDEX "admin_action_logs_syncId_key" ON "admin_action_logs"("syncId");
CREATE UNIQUE INDEX "section_memberships_userId_sectionId_key" ON "section_memberships"("userId", "sectionId");
CREATE INDEX "section_memberships_sectionId_idx" ON "section_memberships"("sectionId");

ALTER TABLE "section_memberships"
  ADD CONSTRAINT "section_memberships_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "section_memberships"
  ADD CONSTRAINT "section_memberships_sectionId_fkey"
  FOREIGN KEY ("sectionId") REFERENCES "sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
