const DEFAULT_TIME_TYPE = 'ANY';

function hasSnapshot(subscription) {
  return subscription.tariffName !== null && subscription.tariffName !== undefined;
}

export function getSubscriptionPlan(subscription) {
  const tariff = subscription.tariff || {};
  const snapshot = hasSnapshot(subscription);

  return {
    name: snapshot ? subscription.tariffName : tariff.name,
    visitsAmount: snapshot ? subscription.visitsAmount : tariff.visitsAmount,
    durationDays: snapshot ? subscription.tariffDurationDays : tariff.durationDays,
    timeType: snapshot ? subscription.timeType : (tariff.timeType || DEFAULT_TIME_TYPE),
    timeStart: snapshot ? subscription.timeStart : (tariff.timeStart || null),
    timeEnd: snapshot ? subscription.timeEnd : (tariff.timeEnd || null),
  };
}

export function subscriptionSnapshot(tariff) {
  return {
    tariffName: tariff.name,
    visitsAmount: tariff.visitsAmount,
    tariffDurationDays: tariff.durationDays,
    timeType: tariff.timeType,
    timeStart: tariff.timeStart,
    timeEnd: tariff.timeEnd,
    freezeDaysTotal: tariff.freezeDaysAllowed,
    guestVisitsTotal: tariff.guestVisitsAllowed,
    guestVisitsRemaining: tariff.guestVisitsAllowed,
  };
}

export function isUnlimitedSubscription(subscription) {
  return getSubscriptionPlan(subscription).visitsAmount === null;
}
