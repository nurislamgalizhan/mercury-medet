import crypto from 'crypto';

const REQUEST_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const TEMPORARY_PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TEMPORARY_PASSWORD_LENGTH = 8;

export function createRegistrationStatusToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, tokenHash: hashRegistrationStatusToken(token) };
}

export function hashRegistrationStatusToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export function collectRegistrationStatusTokenHashes(...recordGroups) {
  const records = recordGroups.flat();
  return [...new Set(records.map((record) => record?.statusTokenHash).filter(Boolean))];
}

// One continuous run of characters: administrators read these out over the phone,
// and the old XXXX-XXXX-XXXX grouping had people guessing where the dashes went.
export function generateTemporaryPassword() {
  return Array.from({ length: TEMPORARY_PASSWORD_LENGTH }, () => (
    TEMPORARY_PASSWORD_ALPHABET[crypto.randomInt(TEMPORARY_PASSWORD_ALPHABET.length)]
  )).join('');
}

export async function cleanupExpiredRegistrationRequests(prismaClient, now = new Date()) {
  const cutoff = new Date(now.getTime() - REQUEST_RETENTION_MS);
  const [adminRequests, whatsappAttempts, statusReceipts, passwordResetRequests] = await prismaClient.$transaction([
    prismaClient.adminVerificationRequest.deleteMany({
      where: { createdAt: { lt: cutoff } },
    }),
    prismaClient.registrationAttempt.deleteMany({
      where: { createdAt: { lt: cutoff } },
    }),
    prismaClient.registrationStatusReceipt.deleteMany({
      where: { createdAt: { lt: cutoff } },
    }),
    prismaClient.adminPasswordResetRequest.deleteMany({
      where: { createdAt: { lt: cutoff } },
    }),
  ]);

  const trustedDevices = await prismaClient.adminTrustedDevice.deleteMany({
    where: { expiresAt: { lt: now } },
  });

  return {
    trustedDevices: trustedDevices.count,
    adminRequests: adminRequests.count,
    whatsappAttempts: whatsappAttempts.count,
    statusReceipts: statusReceipts.count,
    passwordResetRequests: passwordResetRequests.count,
  };
}

export function startRegistrationCleanupJob(prismaClient) {
  const runCleanup = () => {
    cleanupExpiredRegistrationRequests(prismaClient).catch((error) => {
      console.error('[Registration cleanup] Failed:', error.message);
    });
  };

  runCleanup();
  const timer = setInterval(runCleanup, 24 * 60 * 60 * 1000);
  timer.unref?.();
  return timer;
}
