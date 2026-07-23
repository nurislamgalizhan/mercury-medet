import { prisma } from '../db.js';
import { clearExpiredVisits, clearExpiredVisitsForUsers } from './subscription.js';

const TIME_TYPE_LABELS = {
  ANY: 'Любое время',
  MORNING: 'Дневное время',
  EVENING: 'Вечернее время',
};

function sanitizeUser(user) {
  const { passwordHash, verificationCode, verificationCodeExpires, ...rest } = user;
  return rest;
}

function buildTariffWindowLabel(tariff) {
  if (!tariff) return null;
  if (tariff.timeType === 'ANY') return TIME_TYPE_LABELS.ANY;
  if (tariff.timeStart && tariff.timeEnd) {
    return `${TIME_TYPE_LABELS[tariff.timeType]}: ${tariff.timeStart}-${tariff.timeEnd}`;
  }
  return TIME_TYPE_LABELS[tariff.timeType];
}

export async function buildUserProfile(inputUser) {
  await clearExpiredVisitsForUsers(prisma);
  const user = await clearExpiredVisits(prisma, inputUser);

  const subscriptions = await prisma.userSubscription.findMany({
    where: { userId: user.id },
    orderBy: [{ section: { sortOrder: 'asc' } }, { createdAt: 'desc' }],
    include: {
      section: true,
      tariff: true,
      saleLog: true,
    },
  });

  const activeSubscriptions = subscriptions
    .filter((subscription) => subscription.status === 'ACTIVE')
    .map((subscription) => ({
      id: subscription.id,
      sectionId: subscription.sectionId,
      section: subscription.section,
      tariffId: subscription.tariffId,
      tariff: {
        id: subscription.tariff.id,
        name: subscription.tariff.name,
        visitsAmount: subscription.tariff.visitsAmount,
        durationDays: subscription.tariff.durationDays,
        price: subscription.tariff.price,
        timeType: subscription.tariff.timeType,
        timeStart: subscription.tariff.timeStart,
        timeEnd: subscription.tariff.timeEnd,
        accessLabel: buildTariffWindowLabel(subscription.tariff),
      },
      visitsBalance: subscription.visitsBalance,
      subscriptionEnd: subscription.subscriptionEnd,
      frozenUntil: subscription.frozenUntil,
      status: subscription.status,
      isShared: Boolean(subscription.syncId),
      sourceSite: subscription.originSite,
    }));

  const currentSubscription = activeSubscriptions[0] || null;
  const currentTariff = currentSubscription?.tariff || null;
  const isSingleVisitTariff = Boolean(activeSubscriptions.length === 1 && currentTariff?.visitsAmount === 1);

  return {
    ...sanitizeUser(user),
    subscriptions: subscriptions.map((subscription) => ({
      ...subscription,
      isShared: Boolean(subscription.syncId),
      sourceSite: subscription.originSite,
    })),
    activeSubscriptions,
    isUnlimitedSubscription: activeSubscriptions.some((subscription) => subscription.tariff.visitsAmount === null),
    isSingleVisitTariff,
    currentSubscription,
    currentTariff,
  };
}
