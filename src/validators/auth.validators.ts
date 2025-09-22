// src/validators/auth.validators.ts

/**
 * =============================================================================
 * Auth Validators — lightweight Express middlewares for /api/auth
 * =============================================================================
 * Purpose
 *  - Centralize request-body validation for auth routes without external deps.
 *  - Keep a consistent 400 response shape:
 *      { message: "Validation error", errors: [{ field, message }, ...] }
 *
 * Exports
 *  - validateRegisterBody   → username, firstName, lastName, email, password
 *  - validateLoginBody      → identifier , password
 *  - validateRefreshBody    → refreshToken
 *
 * Usage (in routes):
 *  import {
 *    validateRegisterBody,
 *    validateLoginBody,
 *    validateRefreshBody,
 *  } from '../validators/auth.validators.js';
 *
 *  authRouter.post('/register', validateRegisterBody, AuthController.register);
 *  authRouter.post('/login', validateLoginBody, AuthController.login);
 *  authRouter.post('/refresh', validateRefreshBody, AuthController.refresh);
 * =============================================================================
 */

import type { Request, Response, NextFunction } from 'express';

/* -----------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------------*/

/** True when value is a non-empty string after trimming. */
function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/** Minimal email sanity check (good enough for API layer validation). */
function isEmailLike(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

/** Send a standardized 400 validation error response. */
function validationError(
  res: Response,
  errors: Array<{ field: string; message: string }>
) {
  return res.status(400).json({
    message: 'Validation error',
    errors,
  });
}

/* -----------------------------------------------------------------------------
 * Middlewares
 * ---------------------------------------------------------------------------*/

/**
 * Validate body for `POST /api/auth/register`.
 * Requires: username, firstName, lastName, email, password.
 */
export function vRegisterBody(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const { username, firstName, lastName, email, password } = req.body ?? {};
  const errors: Array<{ field: string; message: string }> = [];

  if (!isNonEmptyString(username))
    errors.push({ field: 'username', message: 'username is required' });
  if (!isNonEmptyString(firstName))
    errors.push({ field: 'firstName', message: 'firstName is required' });
  if (!isNonEmptyString(lastName))
    errors.push({ field: 'lastName', message: 'lastName is required' });
  if (!isNonEmptyString(email) || !isEmailLike(email))
    errors.push({ field: 'email', message: 'valid email is required' });
  if (!isNonEmptyString(password))
    errors.push({ field: 'password', message: 'password is required' });

  if (errors.length) return validationError(res, errors);
  return next();
}

/**
 * Validate body for `POST /api/auth/login`.
 * Requires: identifier , password.
 */
export function vLoginBody(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const { identifier, password } = req.body ?? {};
  const errors: Array<{ field: string; message: string }> = [];

  if (!isNonEmptyString(identifier))
    errors.push({
      field: 'identifier ',
      message: 'identifier  is required',
    });
  if (!isNonEmptyString(password))
    errors.push({ field: 'password', message: 'password is required' });

  if (errors.length) return validationError(res, errors);
  return next();
}

/**
 * Validate body for `POST /api/auth/refresh`.
 * Requires: refreshToken.
 */
export function vRefreshBody(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const { refreshToken } = req.body ?? {};
  if (!isNonEmptyString(refreshToken)) {
    return validationError(res, [
      { field: 'refreshToken', message: 'refreshToken is required' },
    ]);
  }
  return next();
}
