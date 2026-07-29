import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../db.js';
import {
  registerSchema,
  loginSchema,
  verifyCodeSchema,
  resendCodeSchema,
  verifyRegistrationSchema,
  resendRegistrationCodeSchema,
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

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_SECONDS = 60;

function signToken(user) {
  return jwt.sign(
    { userId: user.id, role: user.role, tokenVersion: user.tokenVersion ?? 0 },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

export function checkResendCooldown(verificationCodeExpires) {
  if (!verificationCodeExpires) return null;
  const sentAt = new Date(verificationCodeExpires.getTime() - CODE_TTL_MS);
  const secondsLeft = Math.ceil(
    (sentAt.getTime() + RESEND_COOLDOWN_SECONDS * 1000 - Date.now()) / 1000
  );
  return secondsLeft > 0 ? secondsLeft : null;
}

async function findRegistrationAttempt({ phone, requestToken }) {
  if (requestToken) {
    return prisma.registrationAttempt.findUnique({
      where: { statusTokenHash: hashRegistrationStatusToken(requestToken) },
    });
  }
  return prisma.registrationAttempt.findUnique({ where: { phone } });
}

async function issueCodeToAttempt(attemptId, phone, context) {
  const code = generateVerificationCode();
  const expires = new Date(Date.now() + CODE_TTL_MS);
  const updated = await prisma.registrationAttempt.update({
    where: { id: attemptId },
    data: { verificationCode: code, verificationCodeExpires: expires },
  });

  try {
    await sendVerificationCode(phone, code, updated.firstName);
    return { ok: true, attempt: updated, resendCooldown: RESEND_COOLDOWN_SECONDS };
  } catch (error) {
    console.error(`[${context}] Green API error:`, error.message);
    await prisma.registrationAttempt.update({
      where: { id: attemptId },
      data: { verificationCode: null },
    });
    return { ok: false, error };
  }
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
      data: { verificationCode: null },
    });
    return { ok: false, user: updated, error };
  }
}

export async function register(req, res, next) {
  try {
    const {
      firstName,
      lastName,
      phone,
      password,
      verificationMethod,
    } = registerSchema.parse(req.body);

    const existingUser = await prisma.user.findUnique({ where: { phone } });
    if (existingUser) {
      return res.status(409).json({ message: 'Пользователь с таким номером уже существует' });
    }

    await cleanupExpiredRegistrationRequests(prisma);
    const passwordHash = await bcrypt.hash(password, 12);
    const { token: requestToken, tokenHash: statusTokenHash } = createRegistrationStatusToken();

    if (verificationMethod === 'ADMIN') {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const created = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${phone}))`;
        const recentRequests = await tx.adminVerificationRequest.count({
          where: { phone, createdAt: { gte: since } },
        });
        if (recentRequests >= 3) return false;
        await tx.adminVerificationRequest.create({
          data: {
            firstName,
            lastName,
            phone,
            passwordHash,
            statusTokenHash,
          },
        });
        return true;
      });
      if (!created) {
        return res.status(429).json({
          message: 'Для этого номера уже создано три заявки за последние 24 часа',
        });
      }

      return res.status(202).json({
        message: 'Заявка отправлена администратору',
        status: 'PENDING_ADMIN',
        requestToken,
      });
    }

    const existingAttempt = await prisma.registrationAttempt.findUnique({ where: { phone } });
    const secondsLeft = checkResendCooldown(existingAttempt?.verificationCodeExpires);
    if (secondsLeft) {
      return res.status(429).json({
        message: `Код уже отправлен. Подождите ${secondsLeft} сек. перед повторной отправкой`,
        resendCooldown: secondsLeft,
      });
    }

    const attempt = await prisma.registrationAttempt.upsert({
      where: { phone },
      update: { passwordHash, firstName, lastName, statusTokenHash },
      create: { phone, passwordHash, firstName, lastName, statusTokenHash },
    });

    const result = await issueCodeToAttempt(attempt.id, phone, 'Register');
    if (!result.ok) {
      return res.status(result.error?.statusCode || 502).json({
        message: 'Не удалось отправить код подтверждения в WhatsApp. Выберите подтверждение через администратора.',
      });
    }

    res.status(201).json({
      message: 'Код подтверждения отправлен в WhatsApp.',
      status: 'PENDING_WHATSAPP',
      requestToken,
      resendCooldown: result.resendCooldown,
    });
  } catch (error) {
    next(error);
  }
}

export async function verifyPhone(req, res, next) {
  try {
    const { phone, requestToken, code } = verifyRegistrationSchema.parse(req.body);
    const attempt = await findRegistrationAttempt({ phone, requestToken });
    if (!attempt) {
      return res.status(404).json({ message: 'Регистрация не найдена или уже завершена' });
    }
    if (!attempt.verificationCode || attempt.verificationCode !== code) {
      return res.status(400).json({ message: 'Неверный код подтверждения' });
    }
    if (!attempt.verificationCodeExpires || attempt.verificationCodeExpires < new Date()) {
      return res.status(400).json({ message: 'Срок действия кода истек. Запросите новый.' });
    }

    const user = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${attempt.phone}))`;
      const currentAttempt = await tx.registrationAttempt.findUnique({ where: { id: attempt.id } });
      if (!currentAttempt) {
        const error = new Error('Регистрация уже обработана');
        error.statusCode = 409;
        throw error;
      }
      if (
        !currentAttempt.verificationCode
        || currentAttempt.verificationCode !== code
        || !currentAttempt.verificationCodeExpires
        || currentAttempt.verificationCodeExpires < new Date()
      ) {
        const error = new Error('Код подтверждения изменился или истек. Введите актуальный код.');
        error.statusCode = 409;
        throw error;
      }
      const existingUser = await tx.user.findUnique({ where: { phone: currentAttempt.phone } });
      if (existingUser) {
        const error = new Error('Пользователь с таким номером уже существует');
        error.statusCode = 409;
        throw error;
      }

      const created = await tx.user.create({
        data: {
          firstName: currentAttempt.firstName,
          lastName: currentAttempt.lastName,
          phone: currentAttempt.phone,
          passwordHash: currentAttempt.passwordHash,
          isVerified: true,
          registrationStatusTokenHash: currentAttempt.statusTokenHash,
        },
      });
      await tx.registrationAttempt.deleteMany({ where: { phone: currentAttempt.phone } });
      await tx.adminVerificationRequest.deleteMany({ where: { phone: currentAttempt.phone } });
      return created;
    });

    const token = signToken(user);
    const profile = await buildUserProfile(user);
    res.json({ message: 'Аккаунт успешно подтвержден', token, user: profile });
  } catch (error) {
    next(error);
  }
}

export async function resendCode(req, res, next) {
  try {
    const { phone, requestToken } = resendRegistrationCodeSchema.parse(req.body);
    const attempt = await findRegistrationAttempt({ phone, requestToken });
    if (!attempt) {
      return res.status(404).json({ message: 'Регистрация не найдена' });
    }

    const secondsLeft = checkResendCooldown(attempt.verificationCodeExpires);
    if (secondsLeft) {
      return res.status(429).json({
        message: `Подождите ${secondsLeft} сек. перед повторной отправкой`,
      });
    }

    const result = await issueCodeToAttempt(attempt.id, attempt.phone, 'ResendCode');
    if (!result.ok) {
      return res.status(result.error?.statusCode || 502).json({
        message: 'Не удалось отправить код в WhatsApp. Попробуйте еще раз.',
      });
    }
    res.json({ message: 'Новый код отправлен в WhatsApp' });
  } catch (error) {
    next(error);
  }
}

export async function getRegistrationStatus(req, res, next) {
  try {
    const { requestToken } = registrationStatusSchema.parse(req.body);
    const statusTokenHash = hashRegistrationStatusToken(requestToken);
    const [verifiedUser, adminRequest, whatsappAttempt] = await Promise.all([
      prisma.user.findUnique({
        where: { registrationStatusTokenHash: statusTokenHash },
        select: { id: true },
      }),
      prisma.adminVerificationRequest.findUnique({
        where: { statusTokenHash },
        select: { id: true },
      }),
      prisma.registrationAttempt.findUnique({
        where: { statusTokenHash },
        select: { id: true },
      }),
    ]);

    if (verifiedUser) return res.json({ status: 'VERIFIED' });
    if (adminRequest || whatsappAttempt) return res.json({ status: 'PENDING' });
    return res.json({ status: 'NOT_FOUND' });
  } catch (error) {
    next(error);
  }
}

export async function login(req, res, next) {
  try {
    const { phone, password } = loginSchema.parse(req.body);
    const rateLimitState = getRateLimitState(req.ip, phone);
    if (rateLimitState.blocked) {
      return res.status(429).json({
        message: `Слишком много попыток входа. Повторите через ${rateLimitState.retryAfterSeconds} сек.`,
      });
    }

    const user = await prisma.user.findUnique({ where: { phone } });
    if (!user || !user.isActive || !await bcrypt.compare(password, user.passwordHash)) {
      registerFailedAttempt(req.ip, phone);
      return res.status(401).json({ message: 'Неверный номер телефона или пароль' });
    }

    clearFailedAttempts(req.ip, phone);
    const token = signToken(user);
    const profile = await buildUserProfile(user);
    res.json({ token, user: profile });
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
    if (!user || !user.isActive) {
      return res.json({ message: 'Если номер зарегистрирован, код отправлен в WhatsApp.' });
    }

    const secondsLeft = checkResendCooldown(user.verificationCodeExpires);
    if (secondsLeft) {
      return res.status(429).json({
        message: `Подождите ${secondsLeft} сек. перед повторной отправкой`,
      });
    }

    const result = await issueCodeToUser(user.id, phone, 'ForgotPassword');
    if (!result.ok) {
      return res.status(result.error?.statusCode || 502).json({
        message: 'Не удалось отправить код в WhatsApp. Попробуйте еще раз.',
      });
    }
    res.json({ message: 'Если номер зарегистрирован, код отправлен в WhatsApp.' });
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
    res.json({ message: 'Пароль успешно изменен' });
  } catch (error) {
    next(error);
  }
}

export async function resetPassword(req, res, next) {
  try {
    const { phone, code, newPassword } = req.body;
    if (!phone || !code || !newPassword) {
      return res.status(400).json({ message: 'Заполните все поля' });
    }
    if (newPassword.length < 6 || newPassword.length > 200) {
      return res.status(400).json({ message: 'Пароль должен быть от 6 до 200 символов' });
    }

    const normalizedPhone = resendCodeSchema.parse({ phone }).phone;
    const user = await prisma.user.findUnique({ where: { phone: normalizedPhone } });
    if (!user) return res.status(404).json({ message: 'Пользователь не найден' });
    if (!user.verificationCode || user.verificationCode !== code) {
      return res.status(400).json({ message: 'Неверный код подтверждения' });
    }
    if (!user.verificationCodeExpires || user.verificationCodeExpires < new Date()) {
      return res.status(400).json({ message: 'Срок действия кода истек. Запросите новый.' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        mustChangePassword: false,
        tokenVersion: { increment: 1 },
        verificationCode: null,
        verificationCodeExpires: null,
      },
    });

    clearFailedAttempts(req.ip, normalizedPhone);
    res.json({ message: 'Пароль успешно изменен. Войдите с новым паролем.' });
  } catch (error) {
    next(error);
  }
}
