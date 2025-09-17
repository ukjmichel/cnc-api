// src/middlewares/requireAuth.ts

import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import type { JwtUser } from '../types/auth.js';

const { JWT_SECRET = 'dev_secret' } = process.env;

export interface AuthenticatedRequest extends Request {
  user?: JwtUser;
}

export function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    // Accept token from cookie or "Authorization: Bearer <token>"
    const cookieToken = req.cookies?.access_token as string | undefined;
    const header = req.header('authorization') || req.header('Authorization');
    const headerToken = header?.startsWith('Bearer ')
      ? header.slice(7)
      : undefined;

    const token = cookieToken || headerToken;
    if (!token) return res.status(401).json({ message: 'Unauthorized' });

    const decoded = jwt.verify(token, JWT_SECRET) as JwtUser;
    // decoded contains fields we signed (userId, username, email, verified)
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ message: 'Unauthorized' });
  }
}
