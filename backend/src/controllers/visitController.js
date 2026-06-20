import { prisma } from '../db.js';
import { adminCheckInSchema, checkInSchema, logsQuerySchema, paginationSchema } from '../schemas/index.js';
import { emitNewVisit } from '../socket/index.js';
import { createAdminAction } from '../utils/adminActions.js';
import { clearExpiredVisitsForUsers } from '../utils/subscription.js';
import { getDuplicateVisitWarning } from '../utils/visits.js';

function isTimeAllowed(timeType, timeStart, timeEnd) {
  if (timeType === 'ANY') return true;

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const [startH, startM] = (timeStart || '00:00').split(':').map(Number);
  const [endH, endM] = (timeEnd || '23:59').split(':').map(Number);

  return currentMinutes >= startH * 60 + startM && currentMinutes <= endH * 60 + endM;
}

async function getSelectedSubscription(userId, sectionId) {
  await clearExpiredVisitsForUsers(prisma);

  const subscriptions = await prisma.userSubscription.findMany({
    where: {
      userId,
      status: 'ACTIVE',
      ...(sectionId && { sectionId }),
    },
    orderBy: [{ section: { sortOrder: 'asc' } }, { createdAt: 'desc' }],
    include: { section: true, tariff: true },
  });

  if (sectionId && subscriptions.length === 0) {
    return { error: { status: 400, message: 'В выбранной секции нет активного абонемента' } };
  }
  if (!sectionId && subscriptions.length > 1) {
    return {
      error: {
        status: 400,
        code: 'SECTION_SELECTION_REQUIRED',
        message: 'Выберите секцию для списания абонемента',
        subscriptions: subscriptions.map((s) => ({
          id: s.id,
          sectionId: s.sectionId,
          sectionName: s.section.name,
          visitsBalance: s.visitsBalance,
          subscriptionEnd: s.subscriptionEnd,
          tariff: s.tariff,
        })),
      },
    };
  }
  if (subscriptions.length === 0) {
    return { error: { status: 400, message: 'Нет активного абонемента' } };
  }

  return { subscription: subscriptions[0] };
}

function validateSubscriptionForCheckIn(subscription, visitsDeducted, guestCount) {
  const now = new Date();
  if (subscription.frozenUntil && subscription.frozenUntil > now) {
    const until = subscription.frozenUntil.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
    return { status: 400, message: `Абонемент заморожен до ${until}` };
  }
  if (subscription.subscriptionEnd <= now) {
    return { status: 400, message: 'Срок абонемента истек' };
  }

  const { timeType, timeStart, timeEnd, visitsAmount } = subscription.tariff;
  if (!isTimeAllowed(timeType, timeStart, timeEnd)) {
    const timeLabel = timeType === 'MORNING' ? 'дневному' : 'вечернему';
    return {
      status: 403,
      message: `Посещение по ${timeLabel} тарифу недоступно в текущее время (${timeStart}-${timeEnd})`,
    };
  }

  const hasUnlimited = visitsAmount === null;
  if (hasUnlimited && guestCount > 0) {
    return { status: 400, message: 'Безлимитный абонемент не позволяет приглашать гостей' };
  }
  if (!hasUnlimited) {
    if (subscription.visitsBalance <= 0) {
      return { status: 400, message: 'Недостаточно посещений на балансе' };
    }
    if (visitsDeducted > subscription.visitsBalance) {
      return {
        status: 400,
        message: `Нельзя списать ${visitsDeducted} посещений — на балансе только ${subscription.visitsBalance}`,
      };
    }
  }
  return null;
}

export async function checkIn(req, res, next) {
  try {
    const { sectionId, visitsDeducted, guestCount, confirmDuplicate } = checkInSchema.parse(req.body);
    const userId = req.userId;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) {
      return res.status(404).json({ message: 'Пользователь не найден' });
    }

    const selected = await getSelectedSubscription(userId, sectionId);
    if (selected.error) {
      return res.status(selected.error.status).json(selected.error);
    }
    const subscription = selected.subscription;

    const validationError = validateSubscriptionForCheckIn(subscription, visitsDeducted, guestCount);
    if (validationError) {
      return res.status(validationError.status).json({ message: validationError.message });
    }

    const lastVisit = await prisma.visitLog.findFirst({
      where: { userSubscriptionId: subscription.id },
      orderBy: { createdAt: 'desc' },
    });

    const duplicateVisitWarning = getDuplicateVisitWarning(lastVisit?.createdAt);
    if (duplicateVisitWarning && !confirmDuplicate) {
      return res.status(409).json({
        code: 'DUPLICATE_CHECKIN_CONFIRMATION_REQUIRED',
        message: `Вы уже отметились ${duplicateVisitWarning}. Списать еще?`,
        duplicateVisitWarning,
        lastVisitAt: lastVisit.createdAt,
      });
    }

    const hasUnlimited = subscription.tariff.visitsAmount === null;
    const [visitLog, updatedSubscription] = await prisma.$transaction(async (tx) => {
      const log = await tx.visitLog.create({
        data: {
          userId,
          sectionId: subscription.sectionId,
          userSubscriptionId: subscription.id,
          visitsDeducted,
          guestCount,
        },
        include: {
          user: { select: { id: true, firstName: true, lastName: true, phone: true } },
          section: { select: { id: true, name: true } },
        },
      });

      if (hasUnlimited) {
        return [log, subscription];
      }

      const nextVisitsBalance = subscription.visitsBalance - visitsDeducted;
      const updated = await tx.userSubscription.update({
        where: { id: subscription.id },
        data: {
          visitsBalance: { decrement: visitsDeducted },
          ...(nextVisitsBalance <= 0 && { status: 'EXPIRED', frozenUntil: null }),
        },
      });

      if (nextVisitsBalance <= 0) {
        await tx.user.update({
          where: { id: userId },
          data: { visitsBalance: 0, frozenUntil: null },
        });
      }

      return [log, updated];
    });

    emitNewVisit({
      ...visitLog,
      user: { id: user.id, firstName: user.firstName, lastName: user.lastName, phone: user.phone },
      section: { id: subscription.section.id, name: subscription.section.name },
    });

    const guestsLabel = guestCount > 0 ? ` и ${guestCount} гост.` : '';
    res.json({
      message: `Списано ${visitsDeducted} посещ.${guestsLabel}`,
      visitsBalance: updatedSubscription.visitsBalance,
      sectionId: subscription.sectionId,
      visitLog,
    });
  } catch (err) {
    next(err);
  }
}

export async function getVisitLogs(req, res, next) {
  try {
    const { page, limit, from, to, userId, sectionId } = logsQuerySchema.parse(req.query);
    const skip = (page - 1) * limit;

    const where = {
      ...(userId && { userId }),
      ...(sectionId && { sectionId }),
      ...(from || to
        ? {
            createdAt: {
              ...(from && { gte: new Date(from) }),
              ...(to && { lte: new Date(to) }),
            },
          }
        : {}),
    };

    const [logs, total, aggregate] = await Promise.all([
      prisma.visitLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, firstName: true, lastName: true, phone: true } },
          section: { select: { id: true, name: true } },
        },
      }),
      prisma.visitLog.count({ where }),
      prisma.visitLog.aggregate({ where, _sum: { visitsDeducted: true } }),
    ]);

    res.json({
      data: logs,
      meta: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
        totalVisitsDeducted: aggregate._sum.visitsDeducted || 0,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function getMyVisitLogs(req, res, next) {
  try {
    const { page, limit } = paginationSchema.parse(req.query);
    const skip = (page - 1) * limit;
    const where = { userId: req.userId };

    const [logs, total] = await Promise.all([
      prisma.visitLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { section: { select: { id: true, name: true } } },
      }),
      prisma.visitLog.count({ where }),
    ]);

    res.json({
      data: logs,
      meta: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function adminCheckIn(req, res, next) {
  try {
    const { userId, sectionId, visitsDeducted } = adminCheckInSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) {
      return res.status(404).json({ message: 'Пользователь не найден' });
    }

    const selected = await getSelectedSubscription(userId, sectionId);
    if (selected.error) {
      return res.status(selected.error.status).json(selected.error);
    }
    const subscription = selected.subscription;

    const validationError = validateSubscriptionForCheckIn(subscription, visitsDeducted, 0);
    if (validationError) {
      return res.status(validationError.status).json({ message: validationError.message });
    }

    const hasUnlimited = subscription.tariff.visitsAmount === null;
    const [visitLog] = await prisma.$transaction(async (tx) => {
      const log = await tx.visitLog.create({
        data: {
          userId,
          sectionId: subscription.sectionId,
          userSubscriptionId: subscription.id,
          visitsDeducted,
          guestCount: 0,
        },
        include: {
          user: { select: { id: true, firstName: true, lastName: true, phone: true } },
          section: { select: { id: true, name: true } },
        },
      });

      if (!hasUnlimited) {
        const nextVisitsBalance = subscription.visitsBalance - visitsDeducted;
        await tx.userSubscription.update({
          where: { id: subscription.id },
          data: {
            visitsBalance: { decrement: visitsDeducted },
            ...(nextVisitsBalance <= 0 && { status: 'EXPIRED', frozenUntil: null }),
          },
        });

        if (nextVisitsBalance <= 0) {
          await tx.user.update({
            where: { id: userId },
            data: { visitsBalance: 0, frozenUntil: null },
          });
        }
      }

      await createAdminAction(tx, {
        adminId: req.userId,
        targetUserId: userId,
        action: 'ADMIN_VISIT_CHECKIN',
        details: {
          visitsDeducted,
          userName: `${user.firstName} ${user.lastName}`,
          sectionName: subscription.section.name,
        },
      });

      return [log];
    });

    emitNewVisit({
      ...visitLog,
      user: { id: user.id, firstName: user.firstName, lastName: user.lastName, phone: user.phone },
      section: { id: subscription.section.id, name: subscription.section.name },
    });

    res.json({ message: `Списано ${visitsDeducted} посещ. (администратором)`, visitLog });
  } catch (err) {
    next(err);
  }
}
