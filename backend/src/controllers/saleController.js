import { prisma } from '../db.js';
import { logsQuerySchema, refundSaleSchema, sellTariffSchema, updateSaleSchema } from '../schemas/index.js';
import { createAdminAction } from '../utils/adminActions.js';
import { clearExpiredVisitsForUsers } from '../utils/subscription.js';
import {
  commandSharedSubscription,
  confirmSharedSubscription,
  createIdempotencyKey,
  getSyncSite,
  isSharedSection,
  prepareSharedSubscription,
  tariffSnapshot,
} from '../services/syncClient.js';

function resolvePayment({ pricePaid, paymentMethod, cashAmount = 0, cardAmount = 0, cardProvider = null }) {
  const resolvedCardProvider =
    paymentMethod === 'KASPI' ? 'KASPI'
    : paymentMethod === 'HALYK' ? 'HALYK'
    : paymentMethod === 'MIXED' ? cardProvider
    : null;
  const resolvedCash = paymentMethod === 'CASH' ? pricePaid : paymentMethod === 'MIXED' ? cashAmount : 0;
  const resolvedCard = paymentMethod === 'KASPI' || paymentMethod === 'HALYK' ? pricePaid : paymentMethod === 'MIXED' ? cardAmount : 0;

  if (paymentMethod === 'CASH' && resolvedCash !== pricePaid) {
    throw Object.assign(new Error('Сумма наличной оплаты должна совпадать с ценой'), { statusCode: 400 });
  }
  if ((paymentMethod === 'KASPI' || paymentMethod === 'HALYK') && resolvedCard !== pricePaid) {
    throw Object.assign(new Error('Сумма картой должна совпадать с ценой'), { statusCode: 400 });
  }
  if (paymentMethod === 'MIXED') {
    if (!resolvedCardProvider) {
      throw Object.assign(new Error('Укажите провайдера карты (Kaspi или Halyk)'), { statusCode: 400 });
    }
    if (resolvedCash <= 0 || resolvedCard <= 0 || resolvedCash + resolvedCard !== pricePaid) {
      throw Object.assign(new Error('Сумма наличных и картой должна равняться итогу'), { statusCode: 400 });
    }
  }

  return { resolvedCash, resolvedCard, resolvedCardProvider };
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export async function sellTariff(req, res, next) {
  try {
    const { userId, tariffId, pricePaid, paymentMethod, cashAmount, cardAmount, cardProvider } = sellTariffSchema.parse(req.body);
    const { resolvedCash, resolvedCard, resolvedCardProvider } = resolvePayment({ pricePaid, paymentMethod, cashAmount, cardAmount, cardProvider });

    await clearExpiredVisitsForUsers(prisma);

    const [user, tariff] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.tariff.findUnique({ where: { id: tariffId }, include: { section: true } }),
    ]);

    if (!user || !user.isActive) {
      return res.status(404).json({ message: 'Пользователь не найден' });
    }
    if (!user.isVerified) {
      return res.status(400).json({ message: 'Нельзя продавать абонемент не верифицированному пользователю' });
    }
    if (user.role === 'ADMIN') {
      return res.status(403).json({ message: 'Нельзя продавать абонемент администратору' });
    }
    if (!tariff || !tariff.isActive || !tariff.section?.isActive) {
      return res.status(404).json({ message: 'Тариф или секция не найдены/неактивны' });
    }

    const activeInSection = await prisma.userSubscription.findFirst({
      where: { userId, sectionId: tariff.sectionId, status: 'ACTIVE' },
      include: { section: true },
    });
    if (activeInSection) {
      return res.status(400).json({
        message: `У клиента уже есть активный абонемент в секции «${activeInSection.section.name}»`,
      });
    }

    const now = new Date();
    const subscriptionEnd = addDays(now, tariff.durationDays);
    const visitsBalance = tariff.visitsAmount ?? 0;
    const shared = isSharedSection(tariff.section)
      ? await prepareSharedSubscription({
          user: {
            id: user.id,
            firstName: user.firstName,
            lastName: user.lastName,
            phone: user.phone,
          },
          plan: tariffSnapshot(tariff),
          subscriptionEnd: subscriptionEnd.toISOString(),
          idempotencyKey: createIdempotencyKey(`sale:${user.id}:${tariff.id}`),
        })
      : null;

    const created = await prisma.$transaction(async (tx) => {
      const sale = await tx.saleLog.create({
        data: {
          userId,
          sectionId: tariff.sectionId,
          tariffId,
          pricePaid,
          paymentMethod,
          cashAmount: resolvedCash,
          cardAmount: resolvedCard,
          cardProvider: resolvedCardProvider,
        },
      });

      const subscription = await tx.userSubscription.create({
        data: {
          userId,
          sectionId: tariff.sectionId,
          tariffId,
          saleLogId: sale.id,
          visitsBalance,
          subscriptionEnd,
          status: 'ACTIVE',
          ...(shared && {
            syncId: shared.syncId,
            originSite: getSyncSite(),
            projectionVersion: 0,
          }),
        },
        include: { section: true, tariff: true },
      });

      await tx.user.update({
        where: { id: userId },
        data: {
          visitsBalance,
          subscriptionEnd,
          frozenUntil: null,
          ...(shared && { syncMemberId: shared.memberId }),
        },
      });

      if (shared) {
        await tx.sectionMembership.upsert({
          where: { userId_sectionId: { userId, sectionId: tariff.sectionId } },
          update: { sourceSite: getSyncSite() },
          create: { userId, sectionId: tariff.sectionId, sourceSite: getSyncSite() },
        });
      }

      await createAdminAction(tx, {
        adminId: req.userId,
        targetUserId: userId,
        action: 'TARIFF_SOLD',
        details: {
          sectionName: tariff.section.name,
          tariffName: tariff.name,
          pricePaid,
          visitsAmount: tariff.visitsAmount,
          durationDays: tariff.durationDays,
          paymentMethod,
          cashAmount: resolvedCash,
          cardAmount: resolvedCard,
          cardProvider: resolvedCardProvider,
        },
      });

      return { sale, subscription };
    });

    let syncPending = false;
    if (shared) {
      try {
        await confirmSharedSubscription({
          syncId: shared.syncId,
          localSubscriptionId: created.subscription.id,
          idempotencyKey: createIdempotencyKey(`confirm:${shared.syncId}`),
        });
      } catch (syncError) {
        syncPending = true;
        console.error('[Sync] Subscription confirmation pending:', syncError.message);
      }
    }

    res.status(201).json({
      message: syncPending
        ? 'Абонемент продан. Синхронизация будет завершена автоматически.'
        : 'Абонемент продан успешно',
      subscription: created.subscription,
      sale: created.sale,
      syncPending,
    });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ message: err.message });
    next(err);
  }
}

export async function updateSale(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const data = updateSaleSchema.parse(req.body);

    const sale = await prisma.saleLog.findUnique({
      where: { id },
      include: {
        section: true,
        tariff: true,
        user: true,
        subscription: true,
      },
    });
    if (!sale) return res.status(404).json({ message: 'Продажа не найдена' });
    if (sale.status === 'REFUNDED') {
      return res.status(400).json({ message: 'Возвращенную продажу нельзя редактировать' });
    }

    const nextTariff = data.tariffId
      ? await prisma.tariff.findUnique({ where: { id: data.tariffId }, include: { section: true } })
      : sale.tariff;
    if (!nextTariff || !nextTariff.isActive || !nextTariff.section?.isActive) {
      return res.status(404).json({ message: 'Тариф или секция не найдены/неактивны' });
    }

    const changesTariffOrSection = nextTariff.id !== sale.tariffId || nextTariff.sectionId !== sale.sectionId;
    const visitsCount = sale.subscription
      ? await prisma.visitLog.count({ where: { userSubscriptionId: sale.subscription.id } })
      : 0;

    if (changesTariffOrSection && visitsCount > 0) {
      return res.status(400).json({ message: 'Нельзя менять тариф или секцию после первого посещения по абонементу' });
    }

    if (changesTariffOrSection) {
      const conflictingSubscription = await prisma.userSubscription.findFirst({
        where: {
          userId: sale.userId,
          sectionId: nextTariff.sectionId,
          status: 'ACTIVE',
          ...(sale.subscription && { NOT: { id: sale.subscription.id } }),
        },
      });
      if (conflictingSubscription) {
        return res.status(400).json({ message: 'У клиента уже есть активный абонемент в выбранной секции' });
      }
    }

    const mergedPayment = {
      pricePaid: data.pricePaid ?? sale.pricePaid,
      paymentMethod: data.paymentMethod ?? sale.paymentMethod,
      cashAmount: data.cashAmount ?? sale.cashAmount,
      cardAmount: data.cardAmount ?? sale.cardAmount,
      cardProvider: data.cardProvider === undefined ? sale.cardProvider : data.cardProvider,
    };
    const { resolvedCash, resolvedCard, resolvedCardProvider } = resolvePayment(mergedPayment);
    const nextSubscriptionEnd = sale.subscription
      ? addDays(sale.createdAt, nextTariff.durationDays)
      : null;

    if (sale.subscription?.syncId) {
      if (!isSharedSection(nextTariff.section)) {
        return res.status(400).json({
          message: 'Общий абонемент нельзя перенести в другую секцию. Деактивируйте его и оформите новый.',
        });
      }
      await commandSharedSubscription(sale.subscription.syncId, {
        type: 'UPDATE',
        plan: tariffSnapshot(nextTariff),
        subscriptionEnd: nextSubscriptionEnd?.toISOString(),
        visitsBalance: changesTariffOrSection ? (nextTariff.visitsAmount ?? 0) : sale.subscription.visitsBalance,
        actorLabel: `Mercury администратор #${req.userId}`,
        idempotencyKey: createIdempotencyKey(`sale-update:${sale.id}`),
      });
    } else if (isSharedSection(nextTariff.section)) {
      return res.status(400).json({
        message: 'Для переноса в общую секцию оформите новую продажу.',
      });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const nextSale = await tx.saleLog.update({
        where: { id },
        data: {
          tariffId: nextTariff.id,
          sectionId: nextTariff.sectionId,
          pricePaid: mergedPayment.pricePaid,
          paymentMethod: mergedPayment.paymentMethod,
          cashAmount: resolvedCash,
          cardAmount: resolvedCard,
          cardProvider: resolvedCardProvider,
          editedAt: new Date(),
        },
        include: { user: true, tariff: true, section: true, subscription: true },
      });

      if (sale.subscription && changesTariffOrSection) {
        await tx.userSubscription.update({
          where: { id: sale.subscription.id },
          data: {
            tariffId: nextTariff.id,
            sectionId: nextTariff.sectionId,
            visitsBalance: nextTariff.visitsAmount ?? 0,
            subscriptionEnd: nextSubscriptionEnd,
            status: nextSubscriptionEnd && nextSubscriptionEnd <= new Date() ? 'EXPIRED' : 'ACTIVE',
          },
        });
      }

      await createAdminAction(tx, {
        adminId: req.userId,
        targetUserId: sale.userId,
        action: 'SALE_UPDATED',
        details: {
          saleId: sale.id,
          previous: {
            sectionName: sale.section.name,
            tariffName: sale.tariff.name,
            pricePaid: sale.pricePaid,
            paymentMethod: sale.paymentMethod,
            cashAmount: sale.cashAmount,
            cardAmount: sale.cardAmount,
            cardProvider: sale.cardProvider,
          },
          next: {
            sectionName: nextTariff.section.name,
            tariffName: nextTariff.name,
            pricePaid: mergedPayment.pricePaid,
            paymentMethod: mergedPayment.paymentMethod,
            cashAmount: resolvedCash,
            cardAmount: resolvedCard,
            cardProvider: resolvedCardProvider,
          },
        },
      });

      return nextSale;
    });

    res.json({ message: 'Продажа обновлена', sale: updated });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ message: err.message });
    next(err);
  }
}

export async function refundSale(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const { refundAmount } = refundSaleSchema.parse(req.body);

    const sale = await prisma.saleLog.findUnique({
      where: { id },
      include: { subscription: true, tariff: true, section: true, user: true },
    });
    if (!sale) return res.status(404).json({ message: 'Продажа не найдена' });
    if (sale.status === 'REFUNDED') return res.status(400).json({ message: 'Абонемент уже возвращен' });
    if (!sale.subscription) return res.status(400).json({ message: 'Для этой продажи не найден абонемент' });

    const visitsCount = await prisma.visitLog.count({ where: { userSubscriptionId: sale.subscription.id } });
    if (visitsCount > 0) {
      return res.status(400).json({ message: 'Возврат невозможен: по абонементу уже были посещения' });
    }

    if (sale.subscription.syncId) {
      await commandSharedSubscription(sale.subscription.syncId, {
        type: 'REFUND',
        actorLabel: `Mercury администратор #${req.userId}`,
        details: {
          saleId: sale.id,
          sectionName: sale.section.name,
          tariffName: sale.tariff.name,
          pricePaid: sale.pricePaid,
          refundAmount,
        },
        idempotencyKey: createIdempotencyKey(`refund:${sale.id}`),
      });
    }

    const refunded = await prisma.$transaction(async (tx) => {
      const nextSale = await tx.saleLog.update({
        where: { id },
        data: { status: 'REFUNDED', refundAmount, refundedAt: new Date() },
        include: { user: true, tariff: true, section: true, subscription: true },
      });

      await tx.userSubscription.update({
        where: { id: sale.subscription.id },
        data: { status: 'REFUNDED', visitsBalance: 0, frozenUntil: null },
      });

      await createAdminAction(tx, {
        adminId: req.userId,
        targetUserId: sale.userId,
        action: 'SALE_REFUNDED',
        details: {
          saleId: sale.id,
          sectionName: sale.section.name,
          tariffName: sale.tariff.name,
          pricePaid: sale.pricePaid,
          refundAmount,
        },
      });

      return nextSale;
    });

    res.json({ message: 'Возврат оформлен', sale: refunded });
  } catch (err) {
    next(err);
  }
}

export async function getSaleLogs(req, res, next) {
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

    const [logs, total, totalRevenue, totalRefunds] = await Promise.all([
      prisma.saleLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, firstName: true, lastName: true, phone: true } },
          section: { select: { id: true, name: true } },
          tariff: { select: { id: true, name: true, timeType: true, visitsAmount: true, durationDays: true } },
          subscription: { select: { id: true, visitsBalance: true, subscriptionEnd: true, status: true } },
        },
      }),
      prisma.saleLog.count({ where }),
      prisma.saleLog.aggregate({ where, _sum: { pricePaid: true } }),
      prisma.saleLog.aggregate({ where, _sum: { refundAmount: true } }),
    ]);

    res.json({
      data: logs,
      meta: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
        totalRevenue: totalRevenue._sum.pricePaid || 0,
        totalRefunds: totalRefunds._sum.refundAmount || 0,
        netRevenue: (totalRevenue._sum.pricePaid || 0) - (totalRefunds._sum.refundAmount || 0),
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function getMySaleLogs(req, res, next) {
  try {
    const { page, limit } = logsQuerySchema.parse(req.query);
    const skip = (page - 1) * limit;
    const where = { userId: req.userId };

    const [logs, total] = await Promise.all([
      prisma.saleLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          section: { select: { id: true, name: true } },
          tariff: { select: { id: true, name: true, visitsAmount: true, durationDays: true, timeType: true, timeStart: true, timeEnd: true } },
          subscription: { select: { id: true, visitsBalance: true, subscriptionEnd: true, status: true, frozenUntil: true } },
        },
      }),
      prisma.saleLog.count({ where }),
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
