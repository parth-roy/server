import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '@config/env';
import { AppError } from '@shared/errors/AppError';
import { UserRole } from '@prisma/client';

export interface JwtPayload {
  userId: string;
  phone: string;
  role: UserRole;
}

export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return next(AppError.unauthorized('No token provided'));
  }

  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload;
    req.user = { id: payload.userId || (payload as any).id, phone: payload.phone, role: payload.role };
    next();
  } catch (err) {
    if ((err as any).name === 'TokenExpiredError') {
      return next(AppError.unauthorized('Token expired'));
    }
    return next(AppError.unauthorized('Invalid token'));
  }
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(AppError.unauthorized());
    if (!roles.includes(req.user.role as UserRole)) {
      return next(AppError.forbidden('Insufficient permissions'));
    }
    next();
  };
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return next();

  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload;
    req.user = { id: payload.userId || (payload as any).id, phone: payload.phone, role: payload.role };
  } catch {
    // Invalid token — continue without user (optional auth)
  }
  next();
}