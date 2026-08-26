export const DEFAULT_FREEZE_DAYS = 15;
export const MAX_CONFIGURABLE_FREEZE_DAYS = 365;
export const DAY_MS = 24 * 60 * 60 * 1000;

function freezeDaysTotal(subscription) {
  const value = Number(subscription?.freezeDaysTotal ?? DEFAULT_FREEZE_DAYS);
  if (!Number.isFinite(value)) return DEFAULT_FREEZE_DAYS;
  return Math.max(0, Math.min(MAX_CONFIGURABLE_FREEZE_DAYS, Math.trunc(value)));
}

function clampDays(value, total) {
  const days = Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : 0;
  return Math.max(0, Math.min(total, days));
}

export function getFreezeDaysRemaining(subscription) {
  const total = freezeDaysTotal(subscription);
  const used = clampDays(subscription?.freezeDaysUsed, total);
  const reserved = clampDays(subscription?.freezeDaysReserved, total);
  return Math.max(0, total - used - reserved);
}

export function freezePublicState(subscription) {
  const total = freezeDaysTotal(subscription);
  return {
    freezeStartedAt: subscription?.freezeStartedAt || null,
    freezeDaysUsed: clampDays(subscription?.freezeDaysUsed, total),
    freezeDaysReserved: clampDays(subscription?.freezeDaysReserved, total),
    freezeDaysRemaining: getFreezeDaysRemaining(subscription),
    freezeDaysTotal: total,
    freezeUntilManual: Boolean(subscription?.freezeUntilManual),
  };
}

export function createFreezePlan(subscription, { mode, days }, now = new Date()) {
  const remainingDays = getFreezeDaysRemaining(subscription);
  const requestedDays = mode === 'UNTIL_MANUAL' ? remainingDays : Math.trunc(Number(days));

  if (!Number.isInteger(requestedDays) || requestedDays < 1) {
    throw new Error('Выберите хотя бы один день заморозки');
  }
  if (requestedDays > remainingDays) {
    throw new Error(`Доступно только ${remainingDays} дн. заморозки`);
  }

  return {
    ...subscription,
    freezeStartedAt: new Date(now),
    frozenUntil: new Date(now.getTime() + requestedDays * DAY_MS),
    freezeDaysReserved: requestedDays,
    freezeUntilManual: mode === 'UNTIL_MANUAL',
    subscriptionEnd: new Date(subscription.subscriptionEnd.getTime() + requestedDays * DAY_MS),
    requestedDays,
  };
}

export function completeFreezePlan(subscription, now = new Date()) {
  const total = freezeDaysTotal(subscription);
  const usedDays = clampDays(subscription?.freezeDaysUsed, total);
  const reservedDays = clampDays(subscription?.freezeDaysReserved, total);
  const startedAt = subscription?.freezeStartedAt ? new Date(subscription.freezeStartedAt) : null;
  const frozenUntil = subscription?.frozenUntil ? new Date(subscription.frozenUntil) : null;

  // Legacy freezes were already fully credited to subscriptionEnd.
  if (!startedAt || !reservedDays || !frozenUntil) {
    return {
      subscriptionEnd: new Date(subscription.subscriptionEnd),
      freezeDaysUsed: usedDays,
      consumedDays: 0,
      restoredDays: 0,
    };
  }

  const effectiveEnd = new Date(Math.min(now.getTime(), frozenUntil.getTime()));
  const elapsedMs = Math.max(0, effectiveEnd.getTime() - startedAt.getTime());
  const consumedDays = Math.min(reservedDays, Math.max(1, Math.ceil(elapsedMs / DAY_MS)));
  const restoredDays = reservedDays - consumedDays;

  return {
    subscriptionEnd: new Date(subscription.subscriptionEnd.getTime() - restoredDays * DAY_MS),
    freezeDaysUsed: Math.min(total, usedDays + consumedDays),
    consumedDays,
    restoredDays,
  };
}

export function clearedFreezeData(completed) {
  return {
    frozenUntil: null,
    freezeStartedAt: null,
    freezeDaysReserved: 0,
    freezeUntilManual: false,
    freezeDaysUsed: completed.freezeDaysUsed,
    subscriptionEnd: completed.subscriptionEnd,
  };
}
