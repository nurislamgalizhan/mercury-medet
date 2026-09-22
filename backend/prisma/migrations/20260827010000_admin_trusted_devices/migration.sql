CREATE TABLE "admin_trusted_devices" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "label" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "admin_trusted_devices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "admin_trusted_devices_tokenHash_key"
  ON "admin_trusted_devices"("tokenHash");

CREATE INDEX "admin_trusted_devices_userId_idx"
  ON "admin_trusted_devices"("userId");

CREATE INDEX "admin_trusted_devices_expiresAt_idx"
  ON "admin_trusted_devices"("expiresAt");

ALTER TABLE "admin_trusted_devices"
  ADD CONSTRAINT "admin_trusted_devices_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
