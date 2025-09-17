// src/middlewares/errorHandler.ts

/**
 * =============================================================================
 * errorHandler — Centralized Express error middleware
 * =============================================================================
 * What it does
 *  - Catches errors forwarded via `next(err)` from controllers/middleware.
 *  - Maps known domain/library errors to proper HTTP status codes.
 *  - Sends a clean JSON payload; includes stack traces only outside production.
 *
 * Known errors
 *  - NotFoundError     → 404
 *  - DuplicateError    → 409
 *  - AuthError         → 401
 *  - JsonWebTokenError → 401
 *  - TokenExpiredError → 401
 *  - Sequelize:
 *      * UniqueConstraintError → 409 (with details)
 *      * ValidationError       → 400 (with details)
 * =============================================================================
 */

import type { Request, Response, NextFunction } from 'express';
import { ValidationError, UniqueConstraintError } from 'sequelize';
import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { NotFoundError, DuplicateError, AuthError } from '../errors/index.js';

const { JsonWebTokenError, TokenExpiredError } = jwt as unknown as {
  JsonWebTokenError: new (...args: any[]) => Error;
  TokenExpiredError: new (...args: any[]) => Error & { expiredAt?: Date };
};

const isProd = config.nodeEnv === 'production';

/**
 * Express error-handling middleware (must have 4 params).
 */
export function errorHandler(
  err: any,
  _req: Request,
  res: Response,
  next: NextFunction
) {
  // If headers already sent, delegate to Express default handler
  if (res.headersSent) return next(err);

  // Base status/message
  let status =
    (typeof err?.statusCode === 'number' && err.statusCode) ||
    (typeof err?.status === 'number' && err.status) ||
    500;

  let code: string | undefined = err?.code || err?.name;
  let message: string = err?.message || 'Internal Server Error';
  let details: unknown;

  // Domain errors
  if (err instanceof NotFoundError) status = 404;
  else if (err instanceof DuplicateError) status = 409;
  else if (err instanceof AuthError) status = 401;
  // JWT errors
  else if (err instanceof TokenExpiredError) {
    status = 401;
    code = 'TOKEN_EXPIRED';
    message = 'Token expired';
  } else if (err instanceof JsonWebTokenError) {
    status = 401;
    code = 'INVALID_TOKEN';
    message = 'Invalid token';
  }

  // Sequelize errors
  else if (err instanceof UniqueConstraintError) {
    status = 409;
    code = 'UNIQUE_CONSTRAINT';
    details = err.errors?.map((e) => ({
      path: e.path,
      message: e.message,
      value: e.value,
    }));
    if (!message || message === 'Internal Server Error') {
      message = 'Duplicate value violates unique constraint';
    }
  } else if (err instanceof ValidationError) {
    status = 400;
    code = 'VALIDATION_ERROR';
    details = err.errors?.map((e) => ({
      path: e.path,
      message: e.message,
      value: e.value,
      validatorKey: e.validatorKey,
    }));
    if (!message || message === 'Internal Server Error') {
      message = 'Validation failed';
    }
  }

  const payload: Record<string, unknown> = {
    status,
    error: code || 'Error',
    message,
    ...(details ? { details } : {}),
    ...(isProd ? {} : { stack: err?.stack }),
  };

  res.status(status).json(payload);
}
