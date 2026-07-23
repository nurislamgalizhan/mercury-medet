import crypto from 'node:crypto';
import axios from 'axios';

const enabled = process.env.VOLLEYBALL_SYNC_ENABLED === 'true';
const baseUrl = (process.env.VOLLEYBALL_SYNC_URL || 'http://volleyball-sync:4100').replace(/\/$/, '');
const secret = process.env.VOLLEYBALL_SYNC_SECRET || '';
const site = process.env.VOLLEYBALL_SYNC_SITE || 'MERCURY';
const sectionName = process.env.VOLLEYBALL_SYNC_SECTION_NAME || 'Волейбол';

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function signatureFor(timestamp, method, path, body) {
  return crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${method.toUpperCase()}.${path}.${stableStringify(body ?? {})}`)
    .digest('hex');
}

async function request(method, path, body) {
  if (!enabled) {
    const error = new Error('Синхронизация общей секции временно отключена');
    error.statusCode = 503;
    throw error;
  }
  if (!secret) {
    const error = new Error('Сервис синхронизации не настроен');
    error.statusCode = 503;
    throw error;
  }
  const timestamp = String(Date.now());
  try {
    const response = await axios({
      method,
      url: `${baseUrl}${path}`,
      data: body,
      timeout: 8000,
      headers: {
        'x-sync-timestamp': timestamp,
        'x-sync-signature': signatureFor(timestamp, method, path, body),
      },
    });
    return response.data;
  } catch (cause) {
    const error = new Error(
      cause.response?.data?.message || 'Синхронизация временно недоступна. Попробуйте еще раз.'
    );
    error.statusCode = cause.response?.status || 503;
    error.code = cause.response?.data?.code;
    throw error;
  }
}

export function isVolleyballSyncEnabled() {
  return enabled;
}

export function isSharedSection(section) {
  return enabled && section?.name === sectionName;
}

export function getSyncSite() {
  return site;
}

export function createIdempotencyKey(prefix) {
  return `${site}:${prefix}:${crypto.randomUUID()}`;
}

export function tariffSnapshot(tariff) {
  return {
    name: tariff.name,
    visitsAmount: tariff.visitsAmount,
    durationDays: tariff.durationDays,
    price: tariff.price,
    timeType: tariff.timeType,
    timeStart: tariff.timeStart,
    timeEnd: tariff.timeEnd,
  };
}

export function prepareSharedSubscription(payload) {
  return request('post', '/v1/subscriptions/prepare', { ...payload, sourceSite: site });
}

export function confirmSharedSubscription(payload) {
  return request('post', '/v1/subscriptions/confirm', { ...payload, sourceSite: site });
}

export function commandSharedSubscription(syncId, payload) {
  return request('post', `/v1/subscriptions/${syncId}/command`, { ...payload, sourceSite: site });
}

export function checkInSharedSubscription(payload) {
  return request('post', '/v1/checkins', { ...payload, sourceSite: site });
}

export function getSyncStatus() {
  return request('get', '/v1/status');
}
