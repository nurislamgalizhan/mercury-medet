import { prisma } from '../db.js';
import { createTariffSchema, updateTariffSchema } from '../schemas/index.js';

export async function getTariffs(req, res, next) {
  try {
    const onlyActive = req.query.active === 'true';
    const sectionId = req.query.sectionId ? parseInt(req.query.sectionId, 10) : null;
    const tariffs = await prisma.tariff.findMany({
      where: {
        isSyncMirror: false,
        ...(onlyActive && { isActive: true, section: { isActive: true } }),
        ...(sectionId && { sectionId }),
      },
      include: { section: true },
      orderBy: [{ section: { sortOrder: 'asc' } }, { timeType: 'asc' }, { price: 'asc' }],
    });
    res.json(tariffs);
  } catch (err) {
    next(err);
  }
}

export async function getTariffById(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    const tariff = await prisma.tariff.findUnique({ where: { id }, include: { section: true } });
    if (!tariff) return res.status(404).json({ message: 'Тариф не найден' });
    res.json(tariff);
  } catch (err) {
    next(err);
  }
}

export async function createTariff(req, res, next) {
  try {
    const data = createTariffSchema.parse(req.body);
    const tariff = await prisma.tariff.create({ data });
    res.status(201).json(tariff);
  } catch (err) {
    next(err);
  }
}

export async function updateTariff(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    const data = updateTariffSchema.parse(req.body);
    const tariff = await prisma.tariff.update({ where: { id }, data });
    res.json(tariff);
  } catch (err) {
    next(err);
  }
}

export async function deleteTariff(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    // Soft delete — deactivate instead of remove
    await prisma.tariff.update({ where: { id }, data: { isActive: false } });
    res.json({ message: 'Тариф деактивирован' });
  } catch (err) {
    next(err);
  }
}
