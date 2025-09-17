// src/errors/NotFoundError.ts

import { AppError } from './AppError.js';

/**
 * Resource not found (404).
 */
export class NotFoundError extends AppError {
  constructor(message = 'Not found', details?: unknown) {
    super(message, { statusCode: 404, code: 'NOT_FOUND', details });
  }
}
