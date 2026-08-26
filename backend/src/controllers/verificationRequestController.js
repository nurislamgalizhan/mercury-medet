import { prisma } from '../db.js';
import { verificationRequestsQuerySchema } from '../schemas/index.js';
import { createAdminAction } from '../utils/adminActions.js';
import {
  cleanupExpiredRegistrationRequests,
  collectRegistrationStatusTokenHashes,
} from '../utils/registrationSecurity.js';
import { clearFailedAttemptsForIdentifier } from '../utils/authRateLimit.js';
import { resetVisitorPassword } from '../utils/clientPasswordReset.js';

function requestPublic(request, duplicateCount) {
  return {
    kind: 'REGISTRATION',
    id: request.id,
    firstName: request.firstName,
    lastName: request.lastName,
    phone: request.phone,
    createdAt: request.createdAt,
    duplicateCount,
  };
}

function passwordResetRequestPublic(request) {
  return {
    kind: 'PASSWORD_RESET',
    id: request.id,
    userId: request.userId,
    firstName: request.firstName,
    lastName: request.lastName,
    phone: request.phone,
    createdAt: request.createdAt,
    duplicateCount: 1,
  };
}

function buildSearchWhere(search) {
  if (!search) return {};
  const terms = search.split(/\s+/).filter(Boolean);
  const phoneDigits = search.replace(/\D/g, '');

  return {
    AND: terms.map((term) => ({
      OR: [
        { firstName: { contains: term, mode: 'insensitive' } },
        { lastName: { contains: term, mode: 'insensitive' } },
        { phone: { contains: term.replace(/\D/g, '') || term } },
      ],
    })),
    ...(phoneDigits && { phone: { contains: phoneDigits } }),
  };
}

export async function getVerificationRequests(req, res, next) {
  try {
    await cleanupExpiredRegistrationRequests(prisma);
    const { page, limit, search } = verificationRequestsQuerySchema.parse(req.query);
    const where = buildSearchWhere(search);
    const [registrationRequests, passwordResetRequests] = await Promise.all([
      prisma.adminVerificationRequest.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      prisma.adminPasswordResetRequest.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    ]);

    const phones = [...new Set(registrationRequests.map((request) => request.phone))];
    const duplicateGroups = phones.length
      ? await prisma.adminVerificationRequest.groupBy({
          by: ['phone'],
          where: { phone: { in: phones } },
          _count: { _all: true },
        })
      : [];
    const duplicateCounts = new Map(
      duplicateGroups.map((group) => [group.phone, group._count._all])
    );

    const combined = [
      ...registrationRequests.map((request) => (
        requestPublic(request, duplicateCounts.get(request.phone) || 1)
      )),
      ...passwordResetRequests.map(passwordResetRequestPublic),
    ].sort((left, right) => (
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    ));
    const total = combined.length;
    const skip = (page - 1) * limit;

    res.json({
      data: combined.slice(skip, skip + limit),
      meta: {
        total,
        page,
        limit,
        pages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function approvePasswordResetRequest(req, res, next) {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'Некорректная заявка' });
    }

    const result = await prisma.$transaction(async (tx) => {
      const initial = await tx.adminPasswordResetRequest.findUnique({ where: { id } });
      if (!initial) return null;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${initial.phone}))`;
      const request = await tx.adminPasswordResetRequest.findUnique({ where: { id } });
      if (!request) return null;
      const user = await tx.user.findUnique({ where: { id: request.userId } });
      const temporaryPassword = await resetVisitorPassword(tx, {
        user,
        adminId: req.userId,
      });
      return { temporaryPassword, user };
    });

    if (!result) {
      return res.status(404).json({ message: 'Заявка уже обработана или удалена' });
    }
    clearFailedAttemptsForIdentifier(result.user.phone);
    res.json({
      message: 'Временный пароль создан',
      temporaryPassword: result.temporaryPassword,
    });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ message: error.message });
    next(error);
  }
}

export async function deletePasswordResetRequest(req, res, next) {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'Некорректная заявка' });
    }
    const request = await prisma.adminPasswordResetRequest.findUnique({ where: { id } });
    if (!request) {
      return res.status(404).json({ message: 'Заявка уже обработана или удалена' });
    }
    await prisma.$transaction(async (tx) => {
      await tx.adminPasswordResetRequest.delete({ where: { id } });
      await createAdminAction(tx, {
        adminId: req.userId,
        targetUserId: request.userId,
        action: 'CLIENT_PASSWORD_RESET_REQUEST_DELETED',
        details: {
          firstName: request.firstName,
          lastName: request.lastName,
          phone: request.phone,
        },
      });
    });
    res.json({ message: 'Заявка удалена' });
  } catch (error) {
    next(error);
  }
}

export async function verifyClientRequest(req, res, next) {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'Некорректная заявка' });
    }

    const result = await prisma.$transaction(async (tx) => {
      const initial = await tx.adminVerificationRequest.findUnique({ where: { id } });
      if (!initial) return { notFound: true };

      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${initial.phone}))`;
      const selected = await tx.adminVerificationRequest.findUnique({ where: { id } });
      if (!selected) return { notFound: true };

      const [requestsForPhone, whatsappAttempt] = await Promise.all([
        tx.adminVerificationRequest.findMany({
          where: { phone: selected.phone },
          select: { statusTokenHash: true },
        }),
        tx.registrationAttempt.findUnique({
          where: { phone: selected.phone },
          select: { statusTokenHash: true },
        }),
      ]);
      const statusTokenHashes = collectRegistrationStatusTokenHashes(
        requestsForPhone,
        whatsappAttempt
      );

      const existingUser = await tx.user.findUnique({ where: { phone: selected.phone } });
      if (existingUser) {
        if (existingUser.isVerified && statusTokenHashes.length) {
          await tx.registrationStatusReceipt.createMany({
            data: statusTokenHashes.map((tokenHash) => ({ tokenHash, userId: existingUser.id })),
            skipDuplicates: true,
          });
        }
        await tx.adminVerificationRequest.deleteMany({ where: { phone: selected.phone } });
        await tx.registrationAttempt.deleteMany({ where: { phone: selected.phone } });
        return { existingUser: true };
      }

      const user = await tx.user.create({
        data: {
          firstName: selected.firstName,
          lastName: selected.lastName,
          phone: selected.phone,
          passwordHash: selected.passwordHash,
          role: 'VISITOR',
          isVerified: true,
          registrationStatusTokenHash: selected.statusTokenHash,
        },
      });

      if (statusTokenHashes.length) {
        await tx.registrationStatusReceipt.createMany({
          data: statusTokenHashes.map((tokenHash) => ({ tokenHash, userId: user.id })),
          skipDuplicates: true,
        });
      }

      const duplicateCount = requestsForPhone.length;
      await tx.adminVerificationRequest.deleteMany({ where: { phone: selected.phone } });
      await tx.registrationAttempt.deleteMany({ where: { phone: selected.phone } });
      await createAdminAction(tx, {
        adminId: req.userId,
        targetUserId: user.id,
        action: 'CLIENT_VERIFIED_BY_ADMIN',
        details: {
          firstName: user.firstName,
          lastName: user.lastName,
          phone: user.phone,
          removedDuplicateRequests: Math.max(0, duplicateCount - 1),
        },
      });

      return { user };
    });

    if (result.notFound) {
      return res.status(404).json({ message: 'Заявка уже обработана или удалена' });
    }
    if (result.existingUser) {
      return res.status(409).json({
        message: 'Клиент с таким номером уже существует. Остальные заявки удалены.',
      });
    }

    res.json({
      message: 'Клиент успешно верифицирован',
      user: {
        id: result.user.id,
        firstName: result.user.firstName,
        lastName: result.user.lastName,
        phone: result.user.phone,
        isVerified: result.user.isVerified,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function deleteVerificationRequest(req, res, next) {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: 'Некорректная заявка' });
    }

    const request = await prisma.adminVerificationRequest.findUnique({ where: { id } });
    if (!request) {
      return res.status(404).json({ message: 'Заявка уже обработана или удалена' });
    }

    await prisma.$transaction(async (tx) => {
      await tx.adminVerificationRequest.delete({ where: { id } });
      await createAdminAction(tx, {
        adminId: req.userId,
        action: 'CLIENT_VERIFICATION_REQUEST_DELETED',
        details: {
          firstName: request.firstName,
          lastName: request.lastName,
          phone: request.phone,
        },
      });
    });

    res.json({ message: 'Заявка удалена' });
  } catch (error) {
    next(error);
  }
}
