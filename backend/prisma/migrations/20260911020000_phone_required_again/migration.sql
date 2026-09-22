-- A client is always registered with a phone number; only the password is
-- optional, since access is issued separately.
ALTER TABLE "users" ALTER COLUMN "phone" SET NOT NULL;
