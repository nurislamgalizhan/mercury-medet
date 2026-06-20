import { z } from 'zod';
import { normalizePhone } from '../utils/phone.js';

const nameSchema = z
  .string()
  .min(1, 'Поле обязательно')
  .max(200, 'Максимум 200 символов')
  .regex(/^[a-zA-ZА-ЯЁа-яё][a-zA-ZА-ЯЁа-яё\s-]*$/, 'Допускаются только буквы, пробел и дефис');

const phoneSchema = z
  .string()
  .transform(normalizePhone)
  .refine((value) => /^7\d{10}$/.test(value), 'Телефон должен быть в формате +7 (XXX) XXX-XX-XX');

export const registerSchema = z.object({
  firstName: nameSchema,
  lastName: nameSchema,
  phone: phoneSchema,
  password: z.string().min(6, 'Пароль минимум 6 символов').max(200, 'Пароль максимум 200 символов'),
});

export const loginSchema = z.object({
  phone: phoneSchema,
  password: z.string().min(1, 'Пароль обязателен'),
});

export const verifyCodeSchema = z.object({
  phone: phoneSchema,
  code: z.string().length(6, 'Код должен быть 6 цифр'),
});

export const resendCodeSchema = z.object({
  phone: phoneSchema,
});

export const checkInSchema = z.object({
  sectionId: z.number().int().positive().optional(),
  visitsDeducted: z.number().int('Должно быть целым числом').min(1, 'Минимум 1 посещение'),
  guestCount: z.number().int('Должно быть целым числом').min(0, 'Минимум 0 гостей').default(0),
  confirmDuplicate: z.boolean().optional().default(false),
}).superRefine((value, ctx) => {
  if (value.visitsDeducted !== value.guestCount + 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Количество списаний должно учитывать самого клиента и гостей',
      path: ['visitsDeducted'],
    });
  }
});

export const sellTariffSchema = z.object({
  userId: z.number().int().positive(),
  tariffId: z.number().int().positive(),
  pricePaid: z.number().int().min(0, 'Цена не может быть отрицательной'),
  paymentMethod: z.enum(['CASH', 'KASPI', 'HALYK', 'MIXED']),
  cashAmount: z.number().int().min(0).optional().default(0),
  cardAmount: z.number().int().min(0).optional().default(0),
  cardProvider: z.enum(['KASPI', 'HALYK']).nullable().optional(),
}).superRefine((val, ctx) => {
  if (val.paymentMethod === 'CASH') {
    if (val.cashAmount !== val.pricePaid) {
      ctx.addIssue({ code: 'custom', message: 'Сумма наличной оплаты должна совпадать с ценой', path: ['cashAmount'] });
    }
  } else if (val.paymentMethod === 'KASPI' || val.paymentMethod === 'HALYK') {
    if (val.cardAmount !== val.pricePaid) {
      ctx.addIssue({ code: 'custom', message: 'Сумма картой должна совпадать с ценой', path: ['cardAmount'] });
    }
    if (val.cardProvider && val.cardProvider !== val.paymentMethod) {
      ctx.addIssue({ code: 'custom', message: 'Несоответствие провайдера карты', path: ['cardProvider'] });
    }
  } else if (val.paymentMethod === 'MIXED') {
    if (val.cashAmount <= 0 || val.cardAmount <= 0) {
      ctx.addIssue({ code: 'custom', message: 'При смешанной оплате обе суммы должны быть больше 0', path: ['cashAmount'] });
    }
    if (val.cashAmount + val.cardAmount !== val.pricePaid) {
      ctx.addIssue({ code: 'custom', message: 'Сумма наличных и картой должна равняться итогу', path: ['cardAmount'] });
    }
    if (!val.cardProvider) {
      ctx.addIssue({ code: 'custom', message: 'Укажите провайдера карты (Kaspi или Halyk)', path: ['cardProvider'] });
    }
  }
});

export const updateSaleSchema = z.object({
  tariffId: z.number().int().positive().optional(),
  pricePaid: z.number().int().min(0, 'Цена не может быть отрицательной').optional(),
  paymentMethod: z.enum(['CASH', 'KASPI', 'HALYK', 'MIXED']).optional(),
  cashAmount: z.number().int().min(0).optional(),
  cardAmount: z.number().int().min(0).optional(),
  cardProvider: z.enum(['KASPI', 'HALYK']).nullable().optional(),
}).refine(
  (val) => Object.keys(val).length > 0,
  { message: 'Нет данных для обновления' }
);

export const refundSaleSchema = z.object({
  refundAmount: z.number().int().min(0, 'Сумма возврата не может быть отрицательной'),
});

export const adjustUserSchema = z.object({
  userSubscriptionId: z.number().int().positive().optional(),
  visitsBalance: z.number().int().min(0).optional(),
});

export const createTariffSchema = z.object({
  sectionId: z.number().int().positive(),
  name: z.string().min(1).max(100),
  visitsAmount: z.number().int().positive().nullable().optional(),
  durationDays: z.number().int().positive(),
  price: z.number().int().min(0),
  timeType: z.enum(['ANY', 'MORNING', 'EVENING']),
  timeStart: z.string().nullable().optional(),
  timeEnd: z.string().nullable().optional(),
});

export const updateTariffSchema = createTariffSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const logsQuerySchema = paginationSchema.extend({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  userId: z.coerce.number().int().positive().optional(),
  sectionId: z.coerce.number().int().positive().optional(),
});

export const usersQuerySchema = paginationSchema.extend({
  search: z.string().optional(),
  sectionId: z.coerce.number().int().positive().optional(),
});

export const createUserSchema = z.object({
  firstName: nameSchema,
  lastName: nameSchema,
  phone: phoneSchema,
  password: z.string().min(6).max(200),
  role: z.enum(['ADMIN', 'VISITOR']).optional(),
});

export const adminCheckInSchema = z.object({
  userId: z.number().int().positive(),
  sectionId: z.number().int().positive().optional(),
  visitsDeducted: z.number().int().min(1),
});

export const freezeSchema = z.object({
  userSubscriptionId: z.number().int().positive().optional(),
  freezeFrom: z.string().datetime({ offset: true }),
  freezeTo: z.string().datetime({ offset: true }),
}).superRefine((val, ctx) => {
  const from = new Date(val.freezeFrom);
  const to = new Date(val.freezeTo);
  if (to <= from) {
    ctx.addIssue({ code: 'custom', message: 'Дата окончания должна быть позже даты начала', path: ['freezeTo'] });
  }
  const days = Math.ceil((to - from) / (24 * 60 * 60 * 1000));
  if (days > 15) {
    ctx.addIssue({ code: 'custom', message: 'Максимальный срок заморозки — 15 дней', path: ['freezeTo'] });
  }
});

export const cancelSubscriptionSchema = z.object({
  confirmDeactivation: z.literal(true, {
    errorMap: () => ({ message: 'Подтвердите деактивацию абонемента' }),
  }),
});

export const activateSubscriptionSchema = z.object({
  visitsBalance: z.number().int().min(0, 'Баланс не может быть отрицательным').optional(),
});

export const sectionSchema = z.object({
  name: z.string().min(1, 'Название обязательно').max(100, 'Максимум 100 символов'),
  isActive: z.boolean().optional(),
});

export const updateSectionSchema = sectionSchema.partial().refine(
  (val) => Object.keys(val).length > 0,
  { message: 'Нет данных для обновления' }
);
