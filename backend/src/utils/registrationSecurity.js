import crypto from 'crypto';

const REQUEST_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const TEMPORARY_PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function createRegistrationStatusToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, tokenHash: hashRegistrationStatusToken(token) };
}

export function hashRegistrationStatusToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export function generateTemporaryPassword() {
  const characters = Array.from({ length: 12 }, () => (
    TEMPORARY_PASSWORD_ALPHABET[crypto.randomInt(TEMPORARY_PASSWORD_ALPHABET.length)]
  ));
  return [
    characters.slice(0, 4).join(''),
    characters.slice(4, 8).join(''),
    characters.slice(8, 12).join(''),
  ].join('-');
}

export async function cleanupExpiredRegistrationRequests(prismaClient, now = new Date()) {
  const cutoff = new Date(now.getTime() - REQUEST_RETENTION_MS);
  const [adminRequests, whatsappAttempts] = await prismaClient.$transaction([
    prismaClient.adminVerificationRequest.deleteMany({
      where: { createdAt: { lt: cutoff } },
    }),
    prismaClient.registrationAttempt.deleteMany({
      where: { createdAt: { lt: cutoff } },
    }),
  ]);

  return {
    adminRequests: adminRequests.count,
    whatsappAttempts: whatsappAttempts.count,
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
