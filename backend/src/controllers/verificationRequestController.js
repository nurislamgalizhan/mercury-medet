import { prisma } from '../db.js';
import { verificationRequestsQuerySchema } from '../schemas/index.js';
import { createAdminAction } from '../utils/adminActions.js';
import { cleanupExpiredRegistrationRequests } from '../utils/registrationSecurity.js';

function requestPublic(request, duplicateCount) {
  return {
    id: request.id,
    firstName: request.firstName,
    lastName: request.lastName,
    phone: request.phone,
    createdAt: request.createdAt,
    duplicateCount,
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
    const skip = (page - 1) * limit;

    const [requests, total] = await Promise.all([
      prisma.adminVerificationRequest.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      prisma.adminVerificationRequest.count({ where }),
    ]);

    const phones = [...new Set(requests.map((request) => request.phone))];
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

    res.json({
      data: requests.map((request) => (
        requestPublic(request, duplicateCounts.get(request.phone) || 1)
      )),
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

      const existingUser = await tx.user.findUnique({ where: { phone: selected.phone } });
      if (existingUser) {
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

      const duplicateCount = await tx.adminVerificationRequest.count({
        where: { phone: selected.phone },
      });
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
