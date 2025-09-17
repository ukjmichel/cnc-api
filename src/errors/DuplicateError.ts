// src/errors/DuplicateError.ts

import { AppError } from './AppError.js';

/**
 * Unique constraint violation / duplicate resource (409).
 */
export class DuplicateError extends AppError {
  constructor(message = 'Duplicate', details?: unknown) {
    super(message, { statusCode: 409, code: 'DUPLICATE', details });
  }
}
