import bcrypt from 'bcryptjs';
import { prisma } from '../db.js';
import {
  registerSchema,
  loginSchema,
  verifyCodeSchema,
  resendCodeSchema,
  registrationStatusSchema,
  completeTemporaryPasswordSchema,
} from '../schemas/index.js';
import {
  sendVerificationCode,
  generateVerificationCode,
} from '../services/whatsappService.js';
import {
  clearFailedAttempts,
  getRateLimitState,
  registerFailedAttempt,
} from '../utils/authRateLimit.js';
import { buildUserProfile } from '../utils/userProfile.js';
import {
  cleanupExpiredRegistrationRequests,
  createRegistrationStatusToken,
  hashRegistrationStatusToken,
} from '../utils/registrationSecurity.js';
import { signToken } from '../utils/token.js';
import {
  forgetTrustedDevices,
  isTrustedDevice,
  rememberTrustedDevice,
} from '../utils/trustedDevices.js';

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_SECONDS = 60;

export function checkResendCooldown(verificationCodeExpires) {
  if (!verificationCodeExpires) return null;
  const sentAt = new Date(verificationCodeExpires.getTime() - CODE_TTL_MS);
  const secondsLeft = Math.ceil(
    (sentAt.getTime() + RESEND_COOLDOWN_SECONDS * 1000 - Date.now()) / 1000
  );
  return secondsLeft > 0 ? secondsLeft : null;
}

async function issueCodeToUser(userId, phone, context) {
  const code = generateVerificationCode();
  const expires = new Date(Date.now() + CODE_TTL_MS);
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { verificationCode: code, verificationCodeExpires: expires },
  });

  try {
    await sendVerificationCode(phone, code, updated.firstName);
    return { ok: true, user: updated, resendCooldown: RESEND_COOLDOWN_SECONDS };
  } catch (error) {
    console.error(`[${context}] Green API error:`, error.message);
    await prisma.user.update({
      where: { id: userId },
      data: { verificationCode: null, verificationCodeExpires: null },
    });
    return { ok: false, user: updated, error };
  }
}

async function buildAdminMfaResponse(user, context) {
  const secondsLeft = checkResendCooldown(user.verificationCodeExpires);
  if (secondsLeft) {
    return {
      requiresAdminMfa: true,
      phone: user.phone,
      resendCooldown: secondsLeft,
      deliveryFailed: false,
      message: `Код уже отправлен. Повторите через ${secondsLeft} сек.`,
    };
  }

  const result = await issueCodeToUser(user.id, user.phone, context);
  return {
    requiresAdminMfa: true,
    phone: user.phone,
    resendCooldown: result.ok ? result.resendCooldown : 0,
    deliveryFailed: !result.ok,
    message: result.ok
      ? 'Код подтверждения отправлен в WhatsApp.'
      : 'Не удалось отправить код в WhatsApp. Нажмите «Отправить повторно».',
  };
}

export async function register(req, res, next) {
  try {
    const { firstName, lastName, phone, password } = registerSchema.parse(req.body);

    const existingUser = await prisma.user.findUnique({ where: { phone } });
    if (existingUser) {
      return res.status(409).json({ message: 'Пользователь с таким номером уже существует' });
    }

    await cleanupExpiredRegistrationRequests(prisma);
    const passwordHash = await bcrypt.hash(password, 12);
    const { token: requestToken, tokenHash: statusTokenHash } = createRegistrationStatusToken();

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const created = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${phone}))`;
      if (await tx.user.findUnique({ where: { phone }, select: { id: true } })) {
        return 'EXISTS';
      }
      const recentRequests = await tx.adminVerificationRequest.count({
        where: { phone, createdAt: { gte: since } },
      });
      if (recentRequests >= 3) return 'LIMIT';
      await tx.adminVerificationRequest.create({
        data: { firstName, lastName, phone, passwordHash, statusTokenHash },
      });
      await tx.registrationAttempt.deleteMany({ where: { phone } });
      return 'CREATED';
    });
    if (created === 'EXISTS') {
      return res.status(409).json({ message: 'Пользователь с таким номером уже существует' });
    }
    if (created === 'LIMIT') {
      return res.status(429).json({
        message: 'Для этого номера уже создано три заявки за последние 24 часа',
      });
    }

    res.status(202).json({
      message: 'Заявка отправлена администратору',
      status: 'PENDING_ADMIN',
      requestToken,
    });
  } catch (error) {
    next(error);
  }
}

export async function getRegistrationStatus(req, res, next) {
  try {
    const { requestToken } = registrationStatusSchema.parse(req.body);
    const statusTokenHash = hashRegistrationStatusToken(requestToken);
    const [verifiedUser, statusReceipt, adminRequest] = await Promise.all([
      prisma.user.findUnique({
        where: { registrationStatusTokenHash: statusTokenHash },
        select: { id: true },
      }),
      prisma.registrationStatusReceipt.findUnique({
        where: { tokenHash: statusTokenHash },
        select: { id: true },
      }),
      prisma.adminVerificationRequest.findUnique({
        where: { statusTokenHash },
        select: { id: true },
      }),
    ]);

    if (verifiedUser || statusReceipt) return res.json({ status: 'VERIFIED' });
    if (adminRequest) return res.json({ status: 'PENDING' });
    return res.json({ status: 'NOT_FOUND' });
  } catch (error) {
    next(error);
  }
}

export async function login(req, res, next) {
  try {
    const { phone, password, trustedDeviceToken } = loginSchema.parse(req.body);
    const rateLimitState = getRateLimitState(req.ip, phone);
    if (rateLimitState.blocked) {
      return res.status(429).json({
        message: `Слишком много попыток входа. Повторите через ${rateLimitState.retryAfterSeconds} сек.`,
      });
    }

    const user = await prisma.user.findUnique({ where: { phone } });
    // No hash means the administrator has not issued access yet. Same generic
    // message as a wrong password, so the response reveals nothing either way.
    const passwordValid = user?.passwordHash
      ? await bcrypt.compare(password, user.passwordHash)
      : false;
    if (!user || !user.isActive || !passwordValid) {
      registerFailedAttempt(req.ip, phone);
      return res.status(401).json({ message: 'Неверный номер телефона или пароль' });
    }

    clearFailedAttempts(req.ip, phone);
    if (user.role === 'ADMIN') {
      // A remembered device skips the WhatsApp code, never the password.
      const trusted = await isTrustedDevice(prisma, {
        userId: user.id,
        token: trustedDeviceToken,
      });
      if (!trusted) {
        return res.json(await buildAdminMfaResponse(user, 'AdminLogin'));
      }
    }
    const token = signToken(user);
    const profile = await buildUserProfile(user);
    res.json({ token, user: profile });
  } catch (error) {
    next(error);
  }
}

export async function adminMfaVerify(req, res, next) {
  try {
    const { phone, code } = verifyCodeSchema.parse(req.body);
    const rateKey = `admin-mfa:${phone}`;
    const rateLimitState = getRateLimitState(req.ip, rateKey);
    if (rateLimitState.blocked) {
      return res.status(429).json({
        message: `Слишком много попыток. Повторите через ${rateLimitState.retryAfterSeconds} сек.`,
      });
    }

    const user = await prisma.user.findUnique({ where: { phone } });
    if (!user || !user.isActive || user.role !== 'ADMIN') {
      registerFailedAttempt(req.ip, rateKey);
      return res.status(404).json({ message: 'Администратор не найден' });
    }
    if (!user.verificationCode || user.verificationCode !== code) {
      registerFailedAttempt(req.ip, rateKey);
      return res.status(400).json({ message: 'Неверный код подтверждения' });
    }
    if (!user.verificationCodeExpires || user.verificationCodeExpires < new Date()) {
      return res.status(400).json({ message: 'Срок действия кода истек. Запросите новый.' });
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { verificationCode: null, verificationCodeExpires: null },
    });
    clearFailedAttempts(req.ip, rateKey);
    const token = signToken(updated);
    const profile = await buildUserProfile(updated);
    const newTrustedDeviceToken = await rememberTrustedDevice(prisma, {
      userId: updated.id,
      label: req.headers['user-agent'] || null,
    });
    res.json({ token, user: profile, trustedDeviceToken: newTrustedDeviceToken });
  } catch (error) {
    next(error);
  }
}

export async function adminMfaResend(req, res, next) {
  try {
    const { phone } = resendCodeSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { phone } });
    if (!user || !user.isActive || user.role !== 'ADMIN') {
      return res.status(404).json({ message: 'Администратор не найден' });
    }
    const secondsLeft = checkResendCooldown(user.verificationCodeExpires);
    if (secondsLeft) {
      return res.status(429).json({ message: `Подождите ${secondsLeft} сек. перед повторной отправкой` });
    }
    const result = await issueCodeToUser(user.id, user.phone, 'AdminMfaResend');
    if (!result.ok) {
      return res.status(result.error?.statusCode || 502).json({
        message: 'Не удалось отправить код в WhatsApp.',
      });
    }
    res.json({ message: 'Новый код отправлен в WhatsApp', resendCooldown: result.resendCooldown });
  } catch (error) {
    next(error);
  }
}

export async function getMe(req, res, next) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) return res.status(404).json({ message: 'Пользователь не найден' });
    res.json(await buildUserProfile(user));
  } catch (error) {
    next(error);
  }
}

export async function completeTemporaryPassword(req, res, next) {
  try {
    const { newPassword } = completeTemporaryPasswordSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user || !user.isActive) {
      return res.status(404).json({ message: 'Пользователь не найден' });
    }
    if (!user.mustChangePassword) {
      return res.status(409).json({ message: 'Обязательная смена пароля не требуется' });
    }
    if (await bcrypt.compare(newPassword, user.passwordHash)) {
      return res.status(400).json({ message: 'Новый пароль должен отличаться от временного' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        mustChangePassword: false,
        tokenVersion: { increment: 1 },
        verificationCode: null,
        verificationCodeExpires: null,
      },
    });

    clearFailedAttempts(req.ip, updated.phone);
    await forgetTrustedDevices(prisma, updated.id);
    const token = signToken(updated);
    const profile = await buildUserProfile(updated);
    res.json({ message: 'Новый пароль сохранен', token, user: profile });
  } catch (error) {
    next(error);
  }
}

export async function forgotPassword(req, res, next) {
  try {
    const { phone } = resendCodeSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { phone } });
    if (user?.isActive && user.isVerified && user.role === 'VISITOR') {
      await prisma.adminPasswordResetRequest.upsert({
        where: { userId: user.id },
        update: {
          phone: user.phone,
          firstName: user.firstName,
          lastName: user.lastName,
          createdAt: new Date(),
        },
        create: {
          userId: user.id,
          phone: user.phone,
          firstName: user.firstName,
          lastName: user.lastName,
        },
      });
    }
    res.status(202).json({
      message: 'Если клиент с таким номером существует, заявка отправлена администратору.',
    });
  } catch (error) {
    next(error);
  }
}

export async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Заполните все поля' });
    }
    if (newPassword.length < 6 || newPassword.length > 200) {
      return res.status(400).json({ message: 'Пароль должен быть от 6 до 200 символов' });
    }

    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) return res.status(404).json({ message: 'Пользователь не найден' });
    if (!await bcrypt.compare(currentPassword, user.passwordHash)) {
      return res.status(400).json({ message: 'Текущий пароль указан неверно' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    await forgetTrustedDevices(prisma, user.id);
    res.json({ message: 'Пароль успешно изменен' });
  } catch (error) {
    next(error);
  }
}
