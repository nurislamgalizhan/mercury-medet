import bcrypt from 'bcryptjs';
import { createAdminAction } from './adminActions.js';
import { generateTemporaryPassword } from './registrationSecurity.js';
import { forgetTrustedDevices } from './trustedDevices.js';

export async function resetVisitorPassword(tx, { user, adminId, action = 'CLIENT_PASSWORD_RESET' }) {
  if (!user?.isActive) {
    const error = new Error('Клиент не найден');
    error.statusCode = 404;
    throw error;
  }
  if (user.role !== 'VISITOR') {
    const error = new Error('Здесь можно сбросить пароль только клиента');
    error.statusCode = 403;
    throw error;
  }

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await bcrypt.hash(temporaryPassword, 12);
  await tx.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      mustChangePassword: true,
      tokenVersion: { increment: 1 },
      verificationCode: null,
      verificationCodeExpires: null,
    },
  });
  await forgetTrustedDevices(tx, user.id);
  await tx.adminPasswordResetRequest.deleteMany({ where: { userId: user.id } });
  await createAdminAction(tx, {
    adminId,
    targetUserId: user.id,
    action,
    details: {
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
    },
  });

  return temporaryPassword;
}
