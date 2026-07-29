import axios from 'axios';
import { normalizePhone } from '../utils/phone.js';
import { createThrottledQueue } from '../utils/messageQueue.js';

const DEFAULT_API_URL = 'https://api.green-api.com';
const AUTHORIZATION_CACHE_MS = 30 * 1000;
const enqueueMessage = createThrottledQueue({
  intervalMs: process.env.WHATSAPP_SEND_INTERVAL_MS,
  maxPending: process.env.WHATSAPP_MAX_PENDING_MESSAGES,
});
let authorizedUntil = 0;

function getGreenApiConfig() {
  return {
    apiUrl: (process.env.GREEN_API_URL || DEFAULT_API_URL).replace(/\/+$/, ''),
    idInstance: process.env.GREEN_API_ID_INSTANCE,
    tokenInstance: process.env.GREEN_API_TOKEN_INSTANCE,
  };
}

function ensureConfig({ idInstance, tokenInstance }) {
  if (!idInstance || !tokenInstance) {
    throw new Error('Green API не настроен: заполните GREEN_API_ID_INSTANCE и GREEN_API_TOKEN_INSTANCE');
  }
}

function buildMethodUrl(method) {
  const config = getGreenApiConfig();
  ensureConfig(config);
  return `${config.apiUrl}/waInstance${config.idInstance}/${method}/${config.tokenInstance}`;
}

async function ensureInstanceAuthorized() {
  if (authorizedUntil > Date.now()) return;

  const { data } = await axios.get(buildMethodUrl('getStateInstance'), {
    timeout: 10000,
  });
  if (data?.stateInstance !== 'authorized') {
    throw new Error(`Green API instance не авторизован: ${data?.stateInstance || 'unknown'}`);
  }
  authorizedUntil = Date.now() + AUTHORIZATION_CACHE_MS;
}

export function generateVerificationCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function sendWhatsAppMessage(phone, message) {
  const chatId = `${normalizePhone(phone)}@c.us`;

  try {
    return await enqueueMessage(async () => {
      await ensureInstanceAuthorized();
      const { data } = await axios.post(
        buildMethodUrl('sendMessage'),
        { chatId, message },
        {
          timeout: 15000,
          headers: { 'Content-Type': 'application/json' },
        }
      );
      if (!data?.idMessage) throw new Error('Green API не вернул idMessage');
      return data;
    });
  } catch (error) {
    const details = error.response?.data || error.message;
    console.error('[Green API] Failed to send WhatsApp message:', details);
    const wrapped = new Error('Не удалось отправить сообщение WhatsApp через Green API');
    wrapped.statusCode = error.statusCode || (error.response?.status === 429 ? 429 : 502);
    throw wrapped;
  }
}

export function buildVerificationMessage(firstName, code) {
  const safeName = String(firstName || '')
    .replace(/[\n\r\t*_~`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  const greeting = safeName ? `Здравствуйте, ${safeName}!` : 'Здравствуйте!';

  return `${greeting}\n\nВы запросили код подтверждения для Меркурий Медет.\n\nКод подтверждения: *${code}*\nКод действует 10 минут. Никому не сообщайте его.\n\nЕсли вы не запрашивали код, просто проигнорируйте это сообщение.`;
}

export async function sendVerificationCode(phone, code, firstName) {
  return sendWhatsAppMessage(phone, buildVerificationMessage(firstName, code));
}
