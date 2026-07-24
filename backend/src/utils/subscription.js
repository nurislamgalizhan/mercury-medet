import { clearedFreezeData, completeFreezePlan } from './freeze.js';

export function hasExpiredSubscription(user, now = new Date()) {
  return Boolean(user?.subscriptionEnd && user.subscriptionEnd <= now);
}

export async function clearExpiredVisits(prismaClient, user, now = new Date()) {
  if (!hasExpiredSubscription(user, now) || user.visitsBalance <= 0) {
    return user;
  }

  const updated = await prismaClient.user.update({
    where: { id: user.id },
    data: { visitsBalance: 0 },
    select: { visitsBalance: true, updatedAt: true },
  });

  return { ...user, visitsBalance: updated.visitsBalance, updatedAt: updated.updatedAt };
}

export async function finalizeExpiredFreezes(prismaClient, now = new Date()) {
  const subscriptions = await prismaClient.userSubscription.findMany({
    where: {
      status: 'ACTIVE',
      syncId: null,
      frozenUntil: { not: null, lte: now },
    },
  });
  let count = 0;

  for (const subscription of subscriptions) {
    const completed = completeFreezePlan(subscription, subscription.frozenUntil || now);
    await prismaClient.$transaction(async (tx) => {
      const result = await tx.userSubscription.updateMany({
        where: { id: subscription.id, frozenUntil: subscription.frozenUntil },
        data: clearedFreezeData(completed),
      });
      if (!result.count) return;
      count += result.count;
      await tx.user.update({
        where: { id: subscription.userId },
        data: {
          subscriptionEnd: completed.subscriptionEnd,
          frozenUntil: null,
        },
      });
      await tx.adminActionLog.create({
        data: {
          adminId: null,
          targetUserId: subscription.userId,
          action: 'SUBSCRIPTION_UNFROZEN',
          details: {
            automatic: true,
            daysUsed: completed.consumedDays,
            daysRestored: completed.restoredDays,
          },
        },
      });
    });
  }

  return { count };
}

export async function clearExpiredVisitsForUsers(prismaClient, now = new Date()) {
  await finalizeExpiredFreezes(prismaClient, now);
  const finiteTariffs = await prismaClient.tariff.findMany({
    where: { visitsAmount: { not: null } },
    select: { id: true },
  });
  const finiteTariffIds = finiteTariffs.map((tariff) => tariff.id);

  const [expiredSubscriptions, depletedSubscriptions, legacyUsers] = await Promise.all([
    prismaClient.userSubscription.updateMany({
      where: {
        status: 'ACTIVE',
        subscriptionEnd: { lte: now },
        syncId: null,
      },
      data: { status: 'EXPIRED', visitsBalance: 0, frozenUntil: null },
    }),
    finiteTariffIds.length
      ? prismaClient.userSubscription.updateMany({
          where: {
            status: 'ACTIVE',
            tariffId: { in: finiteTariffIds },
            visitsBalance: { lte: 0 },
            syncId: null,
          },
          data: { status: 'EXPIRED', visitsBalance: 0, frozenUntil: null },
        })
      : Promise.resolve({ count: 0 }),
    prismaClient.user.updateMany({
      where: {
        role: 'VISITOR',
        isActive: true,
        subscriptionEnd: { lte: now },
        visitsBalance: { gt: 0 },
      },
      data: { visitsBalance: 0 },
    }),
  ]);

  return { count: expiredSubscriptions.count + depletedSubscriptions.count + legacyUsers.count };
}

export function startExpiredFreezeCleanupJob(prismaClient, options = {}) {
  const logger = options.logger || console;
  const intervalMs = options.intervalMs || 60_000;
  const timer = setInterval(() => {
    finalizeExpiredFreezes(prismaClient)
      .then((result) => {
        if (result.count > 0) {
          logger.log(`[Subscriptions] Automatically unfroze ${result.count} subscription(s)`);
        }
      })
      .catch((err) => {
        logger.error('[Subscriptions] Failed to finalize freezes:', err.message);
      });
  }, intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}

export function getMillisecondsUntilNextDailyCleanup(now = new Date()) {
  const nextRun = new Date(now);
  nextRun.setHours(23, 59, 0, 0);

  if (nextRun <= now) {
    nextRun.setDate(nextRun.getDate() + 1);
  }

  return nextRun.getTime() - now.getTime();
}

const MAX_TIMER_DELAY_MS = 2_147_483_647;

export function startDailyExpiredVisitsCleanupJob(prismaClient, options = {}) {
  const logger = options.logger || console;
  const getDelayMs = options.getDelayMs || getMillisecondsUntilNextDailyCleanup;
  let timeoutId = null;
  let stopped = false;
  let cleanupPromise = null;

  function clearScheduledTimeout() {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  }

  function scheduleNextCleanup() {
    if (stopped) return;
    clearScheduledTimeout();

    const delayMs = Math.max(0, getDelayMs(new Date()));
    timeoutId = setTimeout(runCleanup, Math.min(delayMs, MAX_TIMER_DELAY_MS));
    timeoutId.unref?.();
  }

  async function runCleanup() {
    if (stopped) return;

    if (!cleanupPromise) {
      cleanupPromise = clearExpiredVisitsForUsers(prismaClient)
        .then((result) => {
          if (result.count > 0) {
            logger.log(`[Subscriptions] Cleared expired visit balances for ${result.count} user(s)`);
          }
        })
        .catch((err) => {
          logger.error('[Subscriptions] Failed to clear expired visit balances:', err.message);
        })
        .finally(() => {
          cleanupPromise = null;
        });
    }

    await cleanupPromise;
    scheduleNextCleanup();
  }

  scheduleNextCleanup();

  return {
    runNow: runCleanup,
    stop() {
      stopped = true;
      clearScheduledTimeout();
    },
  };
}
