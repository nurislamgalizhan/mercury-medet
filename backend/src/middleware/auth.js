import jwt from 'jsonwebtoken';
import { prisma } from '../db.js';

async function authenticateRequest(req, res, next, allowTemporaryPassword) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Токен не предоставлен' });
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        role: true,
        isVerified: true,
        isActive: true,
        mustChangePassword: true,
        tokenVersion: true,
      },
    });
    if (!user || !user.isActive) {
      return res.status(401).json({ message: 'Аккаунт не найден или деактивирован' });
    }
    const tokenVersion = payload.tokenVersion ?? 0;
    if (tokenVersion !== user.tokenVersion) {
      return res.status(401).json({ message: 'Сессия устарела. Войдите снова.' });
    }
    if (user.mustChangePassword && !allowTemporaryPassword) {
      return res.status(428).json({
        code: 'PASSWORD_CHANGE_REQUIRED',
        message: 'Необходимо установить новый пароль',
      });
    }

    req.userId = user.id;
    req.userRole = user.role;
    req.authUser = user;
    next();
  } catch {
    return res.status(401).json({ message: 'Недействительный токен' });
  }
}

export function authenticate(req, res, next) {
  return authenticateRequest(req, res, next, false);
}

export function authenticateForPasswordChange(req, res, next) {
  return authenticateRequest(req, res, next, true);
}

export function requireVerified(req, res, next) {
  if (!req.authUser?.isVerified) {
    return res.status(403).json({ message: 'Аккаунт не верифицирован' });
  }
  next();
}

export function requireAdmin(req, res, next) {
  if (req.userRole !== 'ADMIN') {
    return res.status(403).json({ message: 'Недостаточно прав' });
  }
  next();
}
