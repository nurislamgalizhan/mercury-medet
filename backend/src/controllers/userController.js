import bcrypt from 'bcryptjs';
import { prisma } from '../db.js';
import { usersQuerySchema, adjustUserSchema, createUserSchema, logsQuerySchema, freezeSchema, cancelSubscriptionSchema, activateSubscriptionSchema } from '../schemas/index.js';
import { createAdminAction } from '../utils/adminActions.js';
import { clearExpiredVisits, clearExpiredVisitsForUsers } from '../utils/subscription.js';

function userPublic(user) {
  const { passwordHash, verificationCode, verificationCodeExpires, ...rest } = user;
  return rest;
}

async function getSubscriptionForAction(userId, userSubscriptionId) {
  await clearExpiredVisitsForUsers(prisma);

  const subscriptions = await prisma.userSubscription.findMany({
    where: {
      userId,
      status: 'ACTIVE',
      ...(userSubscriptionId && { id: userSubscriptionId }),
    },
    include: { section: true, tariff: true },
    orderBy: [{ section: { sortOrder: 'asc' } }, { createdAt: 'desc' }],
  });

  if (userSubscriptionId && subscriptions.length === 0) {
    return { error: { status: 404, message: 'Абонемент не найден' } };
  }
  if (!userSubscriptionId && subscriptions.length > 1) {
    return { error: { status: 400, message: 'Выберите секцию/абонемент для операции' } };
  }
  if (subscriptions.length === 0) {
    return { error: { status: 400, message: 'У клиента нет активного абонемента' } };
  }

  return { subscription: subscriptions[0] };
}

export async function getUsers(req, res, next) {
  try {
    const { page, limit, search, sectionId } = usersQuerySchema.parse(req.query);
    const skip = (page - 1) * limit;

    await clearExpiredVisitsForUsers(prisma);

    const where = {
      isActive: true,
      role: 'VISITOR',
      ...(sectionId && {
        subscriptions: {
          some: { sectionId, status: 'ACTIVE' },
        },
      }),
      ...(search && {
        OR: [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phone: true,
          role: true,
          visitsBalance: true,
          subscriptionEnd: true,
          isVerified: true,
          isActive: true,
          createdAt: true,
          subscriptions: {
            where: { status: 'ACTIVE' },
            include: {
              section: { select: { id: true, name: true } },
              tariff: { select: { id: true, name: true, visitsAmount: true } },
            },
            orderBy: [{ section: { sortOrder: 'asc' } }, { createdAt: 'desc' }],
          },
        },
      }),
      prisma.user.count({ where }),
    ]);

    res.json({ data: users, meta: { total, page, limit, pages: Math.ceil(total / limit) } });
  } catch (err) {
    next(err);
  }
}

export async function getUserById(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);

    await clearExpiredVisitsForUsers(prisma);

    const foundUser = await prisma.user.findUnique({
      where: { id },
      include: {
        subscriptions: {
          orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
          include: {
            section: true,
            tariff: true,
            saleLog: true,
            visitLogs: { orderBy: { createdAt: 'desc' }, take: 3 },
          },
        },
        visitLogs: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: { section: { select: { id: true, name: true } } },
        },
        saleLogs: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: {
            section: { select: { id: true, name: true } },
            tariff: { select: { name: true, visitsAmount: true } },
            subscription: { select: { id: true, visitsBalance: true, subscriptionEnd: true, status: true } },
          },
        },
      },
    });

    let user = foundUser;

    if (!user || !user.isActive) {
      return res.status(404).json({ message: 'Пользователь не найден' });
    }

    user = await clearExpiredVisits(prisma, user);

    const activeSubscriptions = user.subscriptions.filter((subscription) => subscription.status === 'ACTIVE');
    const isUnlimitedSubscription = activeSubscriptions.some((subscription) => subscription.tariff?.visitsAmount === null);

    res.json({ ...userPublic(user), activeSubscriptions, isUnlimitedSubscription: !!isUnlimitedSubscription });
  } catch (err) {
    next(err);
  }
}

export async function createUser(req, res, next) {
  try {
    const { firstName, lastName, phone, password, role } = createUserSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { phone } });
    if (existing) {
      return res.status(409).json({ message: 'Пользователь с таким номером уже существует' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: { firstName, lastName, phone, passwordHash, role: role || 'VISITOR', isVerified: true },
      });

      await createAdminAction(tx, {
        adminId: req.userId,
        targetUserId: createdUser.id,
        action: 'USER_CREATED',
        details: {
          firstName: createdUser.firstName,
          lastName: createdUser.lastName,
          phone: createdUser.phone,
          role: createdUser.role,
        },
      });

      return createdUser;
    });

    res.status(201).json(userPublic(user));
  } catch (err) {
    next(err);
  }
}

export async function adjustUser(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const data = adjustUserSchema.parse(req.body);

    const foundUser = await prisma.user.findUnique({ where: { id } });
    let user = foundUser;
    if (!user || !user.isActive) {
      return res.status(404).json({ message: 'Пользователь не найден' });
    }

    user = await clearExpiredVisits(prisma, user);

    const selected = await getSubscriptionForAction(id, data.userSubscriptionId);
    if (selected.error) {
      return res.status(selected.error.status).json({ message: selected.error.message });
    }
    const subscription = selected.subscription;

    if (subscription.tariff?.visitsAmount === null) {
      return res.status(400).json({ message: 'У клиента безлимитный абонемент — корректировка посещений недоступна' });
    }

    if (data.visitsBalance !== undefined && subscription.tariff?.visitsAmount != null) {
      if (data.visitsBalance > subscription.tariff.visitsAmount) {
        return res.status(400).json({
          message: `Нельзя установить больше ${subscription.tariff.visitsAmount} посещений (лимит тарифа)`,
        });
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const nextSubscription = await tx.userSubscription.update({
        where: { id: subscription.id },
        data: {
          ...(data.visitsBalance !== undefined && { visitsBalance: data.visitsBalance }),
          ...(data.visitsBalance === 0 && { status: 'EXPIRED', frozenUntil: null }),
        },
        include: { section: true, tariff: true },
      });

      if (data.visitsBalance === 0) {
        await tx.user.update({
          where: { id },
          data: { visitsBalance: 0, frozenUntil: null },
        });
      }

      await createAdminAction(tx, {
        adminId: req.userId,
        targetUserId: id,
        action: 'VISITS_BALANCE_UPDATED',
        details: {
          sectionName: subscription.section.name,
          previousVisitsBalance: subscription.visitsBalance,
          nextVisitsBalance: nextSubscription.visitsBalance,
        },
      });

      return nextSubscription;
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
}

export async function deactivateUser(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return res.status(404).json({ message: 'Пользователь не найден' });
    if (user.role === 'ADMIN') return res.status(403).json({ message: 'Нельзя деактивировать администратора' });

    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { isActive: false } });
      await createAdminAction(tx, {
        adminId: req.userId,
        targetUserId: id,
        action: 'USER_DEACTIVATED',
        details: {
          phone: user.phone,
          fullName: `${user.firstName} ${user.lastName}`,
        },
      });
    });

    res.json({ message: 'Пользователь деактивирован' });
  } catch (err) {
    next(err);
  }
}

export async function cancelSubscription(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const subscriptionId = parseInt(req.params.subscriptionId, 10);
    cancelSubscriptionSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user || !user.isActive) {
      return res.status(404).json({ message: 'Пользователь не найден' });
    }

    const subscription = await prisma.userSubscription.findFirst({
      where: { id: subscriptionId, userId: id },
      include: { section: true, tariff: true },
    });

    if (!subscription) {
      return res.status(404).json({ message: 'Абонемент не найден' });
    }
    if (subscription.status !== 'ACTIVE') {
      return res.status(400).json({ message: 'Можно деактивировать только активный абонемент' });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const nextSubscription = await tx.userSubscription.update({
        where: { id: subscription.id },
        data: { status: 'CANCELLED', visitsBalance: 0, frozenUntil: null },
        include: { section: true, tariff: true },
      });

      const otherActiveCount = await tx.userSubscription.count({
        where: {
          userId: id,
          status: 'ACTIVE',
          NOT: { id: subscription.id },
        },
      });

      if (otherActiveCount === 0) {
        await tx.user.update({
          where: { id },
          data: { visitsBalance: 0, subscriptionEnd: null, frozenUntil: null },
        });
      }

      await createAdminAction(tx, {
        adminId: req.userId,
        targetUserId: id,
        action: 'SUBSCRIPTION_CANCELLED',
        details: {
          subscriptionId: subscription.id,
          sectionName: subscription.section.name,
          tariffName: subscription.tariff.name,
          previousVisitsBalance: subscription.visitsBalance,
          subscriptionEnd: subscription.subscriptionEnd.toISOString(),
        },
      });

      return nextSubscription;
    });

    res.json({ message: 'Абонемент деактивирован', subscription: updated });
  } catch (err) {
    next(err);
  }
}

export async function activateSubscription(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const subscriptionId = parseInt(req.params.subscriptionId, 10);
    const data = activateSubscriptionSchema.parse(req.body);

    await clearExpiredVisitsForUsers(prisma);

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user || !user.isActive) {
      return res.status(404).json({ message: 'Пользователь не найден' });
    }

    const subscription = await prisma.userSubscription.findFirst({
      where: { id: subscriptionId, userId: id },
      include: { section: true, tariff: true },
    });

    if (!subscription) {
      return res.status(404).json({ message: 'Абонемент не найден' });
    }
    if (subscription.status === 'ACTIVE') {
      return res.status(400).json({ message: 'Абонемент уже активен' });
    }
    if (subscription.status === 'REFUNDED') {
      return res.status(400).json({ message: 'Нельзя активировать возвращенный абонемент' });
    }
    if (subscription.subscriptionEnd <= new Date()) {
      return res.status(400).json({ message: 'Нельзя активировать абонемент с истекшим сроком действия' });
    }

    const conflictingSubscription = await prisma.userSubscription.findFirst({
      where: {
        userId: id,
        sectionId: subscription.sectionId,
        status: 'ACTIVE',
        NOT: { id: subscription.id },
      },
    });
    if (conflictingSubscription) {
      return res.status(400).json({ message: 'В этой секции уже есть активный абонемент' });
    }

    const isUnlimited = subscription.tariff?.visitsAmount === null;
    const nextVisitsBalance = isUnlimited ? 0 : (data.visitsBalance ?? Math.max(1, subscription.visitsBalance || 1));
    if (!isUnlimited) {
      if (nextVisitsBalance < 1) {
        return res.status(400).json({ message: 'Для активации укажите минимум 1 посещение' });
      }
      if (nextVisitsBalance > subscription.tariff.visitsAmount) {
        return res.status(400).json({
          message: `Нельзя установить больше ${subscription.tariff.visitsAmount} посещений (лимит тарифа)`,
        });
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const nextSubscription = await tx.userSubscription.update({
        where: { id: subscription.id },
        data: {
          status: 'ACTIVE',
          visitsBalance: nextVisitsBalance,
          frozenUntil: null,
        },
        include: { section: true, tariff: true },
      });

      await tx.user.update({
        where: { id },
        data: {
          visitsBalance: nextVisitsBalance,
          subscriptionEnd: subscription.subscriptionEnd,
          frozenUntil: null,
        },
      });

      await createAdminAction(tx, {
        adminId: req.userId,
        targetUserId: id,
        action: 'VISITS_BALANCE_UPDATED',
        details: {
          activatedSubscription: true,
          sectionName: subscription.section.name,
          tariffName: subscription.tariff.name,
          previousStatus: subscription.status,
          nextStatus: 'ACTIVE',
          previousVisitsBalance: subscription.visitsBalance,
          nextVisitsBalance,
        },
      });

      return nextSubscription;
    });

    res.json({ message: 'Абонемент активирован', subscription: updated });
  } catch (err) {
    next(err);
  }
}

export async function freezeSubscription(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const isAdmin = req.userRole === 'ADMIN';
    const { userSubscriptionId, freezeFrom, freezeTo } = freezeSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user || !user.isActive) {
      return res.status(404).json({ message: 'Пользователь не найден' });
    }

    if (!isAdmin && req.userId !== id) {
      return res.status(403).json({ message: 'Нет доступа' });
    }

    const selected = await getSubscriptionForAction(id, userSubscriptionId);
    if (selected.error) {
      return res.status(selected.error.status).json({ message: selected.error.message });
    }
    const subscription = selected.subscription;

    if (subscription.subscriptionEnd < new Date()) {
      return res.status(400).json({ message: 'Нет активного абонемента для заморозки' });
    }
    if (subscription.frozenUntil && subscription.frozenUntil > new Date()) {
      return res.status(400).json({ message: 'Абонемент уже заморожен' });
    }
    if (subscription.tariff?.visitsAmount === 1) {
      return res.status(400).json({ message: 'Разовое посещение нельзя заморозить' });
    }

    const freezeFromDate = new Date(freezeFrom);
    const freezeToDate = new Date(freezeTo);
    const freezeDays = Math.ceil((freezeToDate - freezeFromDate) / (24 * 60 * 60 * 1000));

    if (freezeToDate > subscription.subscriptionEnd) {
      return res.status(400).json({ message: 'Период заморозки выходит за рамки абонемента' });
    }

    const newSubscriptionEnd = new Date(subscription.subscriptionEnd.getTime() + freezeDays * 24 * 60 * 60 * 1000);

    const updated = await prisma.$transaction(async (tx) => {
      const s = await tx.userSubscription.update({
        where: { id: subscription.id },
        data: { frozenUntil: freezeToDate, subscriptionEnd: newSubscriptionEnd },
        include: { section: true, tariff: true },
      });

      await createAdminAction(tx, {
        adminId: req.userId,
        targetUserId: id,
        action: 'SUBSCRIPTION_FROZEN',
        details: {
          sectionName: subscription.section.name,
          freezeFrom: freezeFromDate.toISOString(),
          frozenUntil: freezeToDate.toISOString(),
          daysAdded: freezeDays,
        },
      });

      return s;
    });

    res.json({ message: `Абонемент заморожен на ${freezeDays} дн.`, frozenUntil: updated.frozenUntil });
  } catch (err) {
    next(err);
  }
}

export async function unfreezeSubscription(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const isAdmin = req.userRole === 'ADMIN';
    const userSubscriptionId = req.body?.userSubscriptionId ? parseInt(req.body.userSubscriptionId, 10) : undefined;

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user || !user.isActive) {
      return res.status(404).json({ message: 'Пользователь не найден' });
    }

    if (!isAdmin && req.userId !== id) {
      return res.status(403).json({ message: 'Нет доступа' });
    }

    const selected = await getSubscriptionForAction(id, userSubscriptionId);
    if (selected.error) {
      return res.status(selected.error.status).json({ message: selected.error.message });
    }
    const subscription = selected.subscription;

    if (!subscription.frozenUntil || subscription.frozenUntil <= new Date()) {
      return res.status(400).json({ message: 'Абонемент не заморожен' });
    }

    const now = new Date();
    const remainingFreezeDays = Math.ceil((subscription.frozenUntil.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
    const newSubscriptionEnd = new Date(subscription.subscriptionEnd.getTime() - remainingFreezeDays * 24 * 60 * 60 * 1000);

    const updated = await prisma.userSubscription.update({
      where: { id: subscription.id },
      data: { frozenUntil: null, subscriptionEnd: newSubscriptionEnd },
      include: { section: true, tariff: true },
    });

    res.json({ message: 'Абонемент разморожен', subscriptionEnd: updated.subscriptionEnd });
  } catch (err) {
    next(err);
  }
}

export async function getAdminActionLogs(req, res, next) {
  try {
    const { page, limit, from, to, userId } = logsQuerySchema.parse(req.query);
    const skip = (page - 1) * limit;

    const where = {
      ...(userId && { targetUserId: userId }),
      ...(from || to
        ? {
            createdAt: {
              ...(from && { gte: new Date(from) }),
              ...(to && { lte: new Date(to) }),
            },
          }
        : {}),
    };

    const [logs, total] = await Promise.all([
      prisma.adminActionLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          admin: { select: { id: true, firstName: true, lastName: true, phone: true } },
          targetUser: { select: { id: true, firstName: true, lastName: true, phone: true } },
        },
      }),
      prisma.adminActionLog.count({ where }),
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
