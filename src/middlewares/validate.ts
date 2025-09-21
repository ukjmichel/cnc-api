// src/middlewares/validate.ts
import type { Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';

/**
 * Collects express-validator errors and returns a 400 payload.
 * Works with express-validator v7+ (uses `path`, not `param`).
 */
export function validate(req: Request, res: Response, next: NextFunction) {
  const result = validationResult(req);
  if (result.isEmpty()) return next();

  const details = result.array().map((e) => {
    const base: Record<string, unknown> = {
      type: (e as any).type,
      message: (e as any).msg,
    };

    if ('path' in e) base.path = (e as any).path;
    if ('location' in e) base.location = (e as any).location;
    if ('value' in e) base.value = (e as any).value;

    // For Alternative/Unknown errors, include nestedErrors if present
    if ('nestedErrors' in e && (e as any).nestedErrors) {
      base.nestedErrors = (e as any).nestedErrors;
    }
    return base;
  });

  return res.status(400).json({
    status: 400,
    error: 'VALIDATION_ERROR',
    message: 'Validation failed',
    details,
  });
}
