import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone } from '../src/utils/phone.js';
import { getDuplicateVisitWarning } from '../src/utils/visits.js';
import {
  clearFailedAttempts,
  clearFailedAttemptsForIdentifier,
  getRateLimitState,
  registerFailedAttempt,
} from '../src/utils/authRateLimit.js';
import {
  clearExpiredVisits,
  clearExpiredVisitsForUsers,
  getMillisecondsUntilNextDailyCleanup,
  hasExpiredSubscription,
} from '../src/utils/subscription.js';
import {
  completeFreezePlan,
  createFreezePlan,
  freezePublicState,
} from '../src/utils/freeze.js';
import { createThrottledQueue } from '../src/utils/messageQueue.js';
import { buildVerificationMessage } from '../src/services/whatsappService.js';
import { checkResendCooldown } from '../src/controllers/authController.js';
import {
  cleanupExpiredRegistrationRequests,
  createRegistrationStatusToken,
  generateTemporaryPassword,
  hashRegistrationStatusToken,
} from '../src/utils/registrationSecurity.js';

test('verification message starts with a sanitized client name and keeps the code visible', () => {
  const message = buildVerificationMessage('  Алия\n_*  ', '123456');

  assert.equal(message.startsWith('Здравствуйте, Алия!'), true);
  assert.match(message, /Код подтверждения: \*123456\*/);
  assert.match(message, /Если вы не запрашивали код/);
  assert.equal(message.includes('\n_*'), false);
});

test('registration resend cooldown blocks a fresh code and allows an older one', () => {
  const originalNow = Date.now;
  Date.now = () => new Date('2026-07-30T12:00:00.000Z').getTime();

  try {
    assert.equal(checkResendCooldown(new Date('2026-07-30T12:09:45.000Z')), 45);
    assert.equal(checkResendCooldown(new Date('2026-07-30T12:08:00.000Z')), null);
  } finally {
    Date.now = originalNow;
  }
});

test('WhatsApp queue serializes messages and rejects excess pending messages', async () => {
  let currentTime = 1000;
  let releaseFirst;
  const firstTask = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const waits = [];
  const starts = [];
  const enqueue = createThrottledQueue({
    intervalMs: 5000,
    maxPending: 3,
    now: () => currentTime,
    wait: async (milliseconds) => {
      waits.push(milliseconds);
      currentTime += milliseconds;
    },
  });

  await Promise.all([
    enqueue(async () => starts.push(currentTime)),
    enqueue(async () => starts.push(currentTime)),
    enqueue(async () => starts.push(currentTime)),
  ]);
  assert.deepEqual(starts, [1000, 6000, 11000]);
  assert.deepEqual(waits, [5000, 5000]);

  const limitedQueue = createThrottledQueue({ intervalMs: 1, maxPending: 1 });
  const first = limitedQueue(() => firstTask);
  await assert.rejects(limitedQueue(async () => 'second'), (error) => error.statusCode === 503);
  releaseFirst();
  await first;
});

test('registration status tokens and temporary passwords use safe formats', () => {
  const first = createRegistrationStatusToken();
  const second = createRegistrationStatusToken();
  assert.notEqual(first.token, second.token);
  assert.equal(first.tokenHash, hashRegistrationStatusToken(first.token));
  assert.match(generateTemporaryPassword(), /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
});

test('registration cleanup removes requests older than 30 days', async () => {
  const now = new Date('2026-07-30T12:00:00.000Z');
  const operations = [];
  const prismaClient = {
    adminVerificationRequest: {
      deleteMany: (payload) => {
        operations.push(['admin', payload]);
        return Promise.resolve({ count: 2 });
      },
    },
    registrationAttempt: {
      deleteMany: (payload) => {
        operations.push(['whatsapp', payload]);
        return Promise.resolve({ count: 3 });
      },
    },
    $transaction: (queries) => Promise.all(queries),
  };

  const result = await cleanupExpiredRegistrationRequests(prismaClient, now);
  assert.deepEqual(result, { adminRequests: 2, whatsappAttempts: 3 });
  assert.equal(operations.length, 2);
  assert.equal(operations[0][1].where.createdAt.lt.toISOString(), '2026-06-30T12:00:00.000Z');
});

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

  for (let index = 0; index < 10; index += 1) {
    registerFailedAttempt('10.0.0.1', phone);
    registerFailedAttempt('10.0.0.2', phone);
  }
  clearFailedAttemptsForIdentifier(phone);
  assert.equal(getRateLimitState('10.0.0.1', phone).blocked, false);
  assert.equal(getRateLimitState('10.0.0.2', phone).blocked, false);
});

test('freeze plan extends the end date only by days actually used', () => {
  const startedAt = new Date('2026-07-25T06:00:00.000Z');
  const originalEnd = new Date('2026-08-10T12:00:00.000Z');
  const subscription = {
    subscriptionEnd: originalEnd,
    freezeDaysUsed: 0,
    freezeDaysReserved: 0,
  };
  const frozen = createFreezePlan(subscription, { mode: 'FIXED', days: 10 }, startedAt);
  assert.equal(frozen.subscriptionEnd.toISOString(), '2026-08-20T12:00:00.000Z');

  const completed = completeFreezePlan(frozen, new Date(startedAt.getTime() + 3.2 * 86400_000));
  assert.equal(completed.consumedDays, 4);
  assert.equal(completed.restoredDays, 6);
  assert.equal(completed.subscriptionEnd.toISOString(), '2026-08-14T12:00:00.000Z');
  assert.equal(completed.freezeDaysUsed, 4);
});

test('until-manual mode auto-finishes when all remaining freeze days are used', () => {
  const startedAt = new Date('2026-07-25T06:00:00.000Z');
  const frozen = createFreezePlan({
    subscriptionEnd: new Date('2026-08-10T12:00:00.000Z'),
    freezeDaysUsed: 5,
    freezeDaysReserved: 0,
  }, { mode: 'UNTIL_MANUAL' }, startedAt);

  assert.equal(frozen.freezeDaysReserved, 10);
  assert.equal(frozen.freezeUntilManual, true);
  assert.equal(freezePublicState(frozen).freezeDaysRemaining, 0);

  const completed = completeFreezePlan(frozen, frozen.frozenUntil);
  assert.equal(completed.freezeDaysUsed, 15);
  assert.equal(completed.restoredDays, 0);
});

test('legacy freeze completion never shifts an already-credited end date', () => {
  const subscriptionEnd = new Date('2026-08-12T12:51:37.205Z');
  const completed = completeFreezePlan({
    subscriptionEnd,
    frozenUntil: new Date('2026-07-26T00:00:00.000Z'),
    freezeStartedAt: null,
    freezeDaysUsed: 0,
    freezeDaysReserved: 0,
  }, new Date('2026-07-25T12:00:00.000Z'));

  assert.equal(completed.subscriptionEnd.toISOString(), subscriptionEnd.toISOString());
  assert.equal(completed.restoredDays, 0);
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
      findMany: async () => [],
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
      syncId: null,
    },
    data: { status: 'EXPIRED', visitsBalance: 0, frozenUntil: null },
  });
  assert.deepEqual(subscriptionUpdateManyPayloads[1], {
    where: {
      status: 'ACTIVE',
      tariffId: { in: [10, 11] },
      visitsBalance: { lte: 0 },
      syncId: null,
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
