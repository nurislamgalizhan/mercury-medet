import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone } from '../src/utils/phone.js';
import { getDuplicateVisitWarning } from '../src/utils/visits.js';
import {
  clearFailedAttempts,
  getRateLimitState,
  registerFailedAttempt,
} from '../src/utils/authRateLimit.js';
import {
  clearExpiredVisits,
  clearExpiredVisitsForUsers,
  getMillisecondsUntilNextDailyCleanup,
  hasExpiredSubscription,
} from '../src/utils/subscription.js';

test('normalizePhone normalizes local and international formats', () => {
  assert.equal(normalizePhone('7771234567'), '77771234567');
  assert.equal(normalizePhone('+7 (775) 232-22-94'), '77752322294');
  assert.equal(normalizePhone('8 (775) 232-22-94'), '77752322294');
});

test('getDuplicateVisitWarning returns human-readable minutes and hours', () => {
  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
  const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const thirteenHoursAgo = new Date(Date.now() - 13 * 60 * 60 * 1000);

  assert.match(getDuplicateVisitWarning(fifteenMinutesAgo), /15 минут/);
  assert.match(getDuplicateVisitWarning(threeHoursAgo), /3 часа/);
  assert.equal(getDuplicateVisitWarning(thirteenHoursAgo), null);
});

test('auth rate limiter blocks after too many attempts and can be reset', () => {
  const ip = '127.0.0.1';
  const phone = '77752322294';
  clearFailedAttempts(ip, phone);

  for (let index = 0; index < 10; index += 1) {
    registerFailedAttempt(ip, phone);
  }

  const blockedState = getRateLimitState(ip, phone);
  assert.equal(blockedState.blocked, true);
  assert.ok(blockedState.retryAfterSeconds > 0);

  clearFailedAttempts(ip, phone);
  assert.equal(getRateLimitState(ip, phone).blocked, false);
});

test('clearExpiredVisits resets remaining visits only after subscription expiry', async () => {
  const now = new Date('2026-05-12T12:00:00.000Z');
  const expiredUser = {
    id: 42,
    visitsBalance: 3,
    subscriptionEnd: new Date('2026-05-11T12:00:00.000Z'),
    saleLogs: [{ id: 1 }],
  };
  let updatePayload = null;
  const prismaClient = {
    user: {
      update: async (payload) => {
        updatePayload = payload;
        return { visitsBalance: 0, updatedAt: now };
      },
    },
  };

  assert.equal(hasExpiredSubscription(expiredUser, now), true);
  const normalized = await clearExpiredVisits(prismaClient, expiredUser, now);

  assert.deepEqual(updatePayload, {
    where: { id: 42 },
    data: { visitsBalance: 0 },
    select: { visitsBalance: true, updatedAt: true },
  });
  assert.equal(normalized.visitsBalance, 0);
  assert.deepEqual(normalized.saleLogs, expiredUser.saleLogs);
  assert.equal(hasExpiredSubscription({ subscriptionEnd: now }, now), true);

  const activeUser = {
    id: 43,
    visitsBalance: 5,
    subscriptionEnd: new Date('2026-05-13T12:00:00.000Z'),
  };
  updatePayload = null;

  assert.equal(hasExpiredSubscription(activeUser, now), false);
  assert.equal(await clearExpiredVisits(prismaClient, activeUser, now), activeUser);
  assert.equal(updatePayload, null);
});

test('expired visits cleanup updates database rows due at the current time', async () => {
  const now = new Date('2026-05-12T12:00:00.000Z');
  let userUpdateManyPayload = null;
  const subscriptionUpdateManyPayloads = [];
  const prismaClient = {
    tariff: {
      findMany: async (payload) => {
        assert.deepEqual(payload, {
          where: { visitsAmount: { not: null } },
          select: { id: true },
        });
        return [{ id: 10 }, { id: 11 }];
      },
    },
    userSubscription: {
      updateMany: async (payload) => {
        subscriptionUpdateManyPayloads.push(payload);
        return { count: subscriptionUpdateManyPayloads.length === 1 ? 3 : 4 };
      },
    },
    user: {
      updateMany: async (payload) => {
        userUpdateManyPayload = payload;
        return { count: 2 };
      },
    },
  };

  const result = await clearExpiredVisitsForUsers(prismaClient, now);

  assert.equal(result.count, 9);
  assert.deepEqual(subscriptionUpdateManyPayloads[0], {
    where: {
      status: 'ACTIVE',
      subscriptionEnd: { lte: now },
    },
    data: { status: 'EXPIRED', visitsBalance: 0, frozenUntil: null },
  });
  assert.deepEqual(subscriptionUpdateManyPayloads[1], {
    where: {
      status: 'ACTIVE',
      tariffId: { in: [10, 11] },
      visitsBalance: { lte: 0 },
    },
    data: { status: 'EXPIRED', visitsBalance: 0, frozenUntil: null },
  });
  assert.deepEqual(userUpdateManyPayload, {
    where: {
      role: 'VISITOR',
      isActive: true,
      subscriptionEnd: { lte: now },
      visitsBalance: { gt: 0 },
    },
    data: { visitsBalance: 0 },
  });
});

test('daily cleanup is scheduled for 23:59 server time', () => {
  assert.equal(
    getMillisecondsUntilNextDailyCleanup(new Date('2026-05-12T23:58:30.000')),
    30 * 1000
  );
  assert.equal(
    getMillisecondsUntilNextDailyCleanup(new Date('2026-05-12T23:59:00.000')),
    24 * 60 * 60 * 1000
  );
  assert.equal(
    getMillisecondsUntilNextDailyCleanup(new Date('2026-05-12T12:00:00.000')),
    (11 * 60 + 59) * 60 * 1000
  );
});
