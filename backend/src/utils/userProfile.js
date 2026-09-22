import { prisma } from '../db.js';
import { clearExpiredVisits, clearExpiredVisitsForUsers } from './subscription.js';
import { freezePublicState } from './freeze.js';
import { getSubscriptionPlan } from './subscriptionPlan.js';

const TIME_TYPE_LABELS = {
  ANY: 'Любое время',
  MORNING: 'Дневное время',
  EVENING: 'Вечернее время',
};

function sanitizeUser(user) {
  const {
    passwordHash,
    verificationCode,
    verificationCodeExpires,
    tokenVersion,
    registrationStatusTokenHash,
    ...rest
  } = user;
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

  const subscriptionPublic = (subscription) => {
    const plan = getSubscriptionPlan(subscription);
    return {
      id: subscription.id,
      sectionId: subscription.sectionId,
      section: subscription.section,
      tariffId: subscription.tariffId,
      tariff: {
        id: subscription.tariff.id,
        name: plan.name,
        visitsAmount: plan.visitsAmount,
        durationDays: plan.durationDays,
        price: subscription.tariff.price,
        timeType: plan.timeType,
        timeStart: plan.timeStart,
        timeEnd: plan.timeEnd,
        accessLabel: buildTariffWindowLabel(plan),
      },
      visitsBalance: subscription.visitsBalance,
      guestVisitsTotal: subscription.guestVisitsTotal,
      guestVisitsRemaining: subscription.guestVisitsRemaining,
      subscriptionEnd: subscription.subscriptionEnd,
      frozenUntil: subscription.frozenUntil,
      ...freezePublicState(subscription),
      status: subscription.status,
      isShared: Boolean(subscription.syncId),
      sourceSite: subscription.originSite,
    };
  };

  const activeSubscriptions = subscriptions
    .filter((subscription) => subscription.status === 'ACTIVE')
    .map(subscriptionPublic);

  const currentSubscription = activeSubscriptions[0] || null;
  const currentTariff = currentSubscription?.tariff || null;
  const isSingleVisitTariff = Boolean(activeSubscriptions.length === 1 && currentTariff?.visitsAmount === 1);

  return {
    ...sanitizeUser(user),
    subscriptions: subscriptions.map(subscriptionPublic),
    activeSubscriptions,
    isUnlimitedSubscription: activeSubscriptions.some((subscription) => subscription.tariff.visitsAmount === null),
    isSingleVisitTariff,
    currentSubscription,
    currentTariff,
  };
}
