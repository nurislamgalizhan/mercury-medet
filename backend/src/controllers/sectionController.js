import { prisma } from '../db.js';
import { sectionSchema, updateSectionSchema } from '../schemas/index.js';

export async function getSections(req, res, next) {
  try {
    const onlyActive = req.query.active === 'true';
    const sections = await prisma.section.findMany({
      where: onlyActive ? { isActive: true } : undefined,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    res.json(sections);
  } catch (err) {
    next(err);
  }
}

export async function createSection(req, res, next) {
  try {
    const data = sectionSchema.parse(req.body);
    const maxSection = await prisma.section.findFirst({
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    const section = await prisma.section.create({
      data: {
        name: data.name.trim(),
        isActive: data.isActive ?? true,
        freezeDaysAllowed: data.freezeDaysAllowed ?? 15,
        sortOrder: (maxSection?.sortOrder ?? -1) + 1,
      },
    });
    res.status(201).json(section);
  } catch (err) {
    next(err);
  }
}

export async function updateSection(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const data = updateSectionSchema.parse(req.body);
    const section = await prisma.section.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name.trim() }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
        ...(data.freezeDaysAllowed !== undefined && { freezeDaysAllowed: data.freezeDaysAllowed }),
      },
    });
    res.json(section);
  } catch (err) {
    next(err);
  }
}

export async function deleteSection(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    await prisma.section.update({ where: { id }, data: { isActive: false } });
    res.json({ message: 'Секция деактивирована' });
  } catch (err) {
    next(err);
  }
}
