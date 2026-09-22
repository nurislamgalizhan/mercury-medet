import crypto from 'crypto';

export const TRUSTED_DEVICE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const LABEL_MAX_LENGTH = 200;

export function hashTrustedDeviceToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export function createTrustedDeviceToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, tokenHash: hashTrustedDeviceToken(token) };
}

// Only the hash is stored, so a database leak cannot be replayed as a device.
export async function rememberTrustedDevice(prismaClient, { userId, label }, now = new Date()) {
  const { token, tokenHash } = createTrustedDeviceToken();
  await prismaClient.adminTrustedDevice.create({
    data: {
      userId,
      tokenHash,
      label: label ? String(label).slice(0, LABEL_MAX_LENGTH) : null,
      expiresAt: new Date(now.getTime() + TRUSTED_DEVICE_TTL_MS),
    },
  });
  return token;
}

// A trusted device only skips the WhatsApp code — the password is still required,
// so a stolen device token on its own grants nothing.
export async function isTrustedDevice(prismaClient, { userId, token }, now = new Date()) {
  if (!token) return false;

  const device = await prismaClient.adminTrustedDevice.findUnique({
    where: { tokenHash: hashTrustedDeviceToken(token) },
  });
  if (!device || device.userId !== userId) return false;

  if (device.expiresAt <= now) {
    await prismaClient.adminTrustedDevice
      .delete({ where: { id: device.id } })
      .catch(() => {});
    return false;
  }

  await prismaClient.adminTrustedDevice.update({
    where: { id: device.id },
    data: { lastUsedAt: now, expiresAt: new Date(now.getTime() + TRUSTED_DEVICE_TTL_MS) },
  });
  return true;
}

export function forgetTrustedDevices(prismaClient, userId) {
  return prismaClient.adminTrustedDevice.deleteMany({ where: { userId } });
}

export function cleanupExpiredTrustedDevices(prismaClient, now = new Date()) {
  return prismaClient.adminTrustedDevice.deleteMany({ where: { expiresAt: { lt: now } } });
}
