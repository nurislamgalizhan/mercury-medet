export async function applySharedSubscriptionState(tx, localSubscription, sharedState) {
  const result = await tx.userSubscription.updateMany({
    where: {
      id: localSubscription.id,
      projectionVersion: { lte: sharedState.version },
    },
    data: {
      visitsBalance: sharedState.visitsBalance,
      subscriptionEnd: new Date(sharedState.subscriptionEnd),
      frozenUntil: sharedState.frozenUntil ? new Date(sharedState.frozenUntil) : null,
      status: sharedState.status,
      projectionVersion: sharedState.version,
    },
  });

  if (result.count > 0) {
    await tx.user.update({
      where: { id: localSubscription.userId },
      data: {
        visitsBalance: sharedState.visitsBalance,
        subscriptionEnd: new Date(sharedState.subscriptionEnd),
        frozenUntil: sharedState.frozenUntil ? new Date(sharedState.frozenUntil) : null,
      },
    });
  }

  return tx.userSubscription.findUnique({
    where: { id: localSubscription.id },
    include: { section: true, tariff: true },
  });
}

export async function applySharedVisit(tx, { localSubscription, sharedResult, userId }) {
  const subscription = await applySharedSubscriptionState(
    tx,
    localSubscription,
    sharedResult.subscription
  );
  const visitData = {
    userId,
    sectionId: localSubscription.sectionId,
    userSubscriptionId: localSubscription.id,
    visitsDeducted: sharedResult.visit.visitsDeducted,
    guestCount: sharedResult.visit.guestCount,
    sourceSite: sharedResult.visit.sourceSite,
    createdAt: new Date(sharedResult.visit.createdAt),
  };

  const visitLog = await tx.visitLog.upsert({
    where: { syncId: sharedResult.visit.syncId },
    update: visitData,
    create: {
      ...visitData,
      syncId: sharedResult.visit.syncId,
    },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, phone: true } },
      section: { select: { id: true, name: true } },
    },
  });

  return { subscription, visitLog };
}
