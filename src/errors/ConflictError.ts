// src/errors/conflict-error.ts
import { AppError } from './AppError.js';

/**
 * Conflict / resource state clash (409).
 * Use for capacity full, duplicate state transitions, version conflicts, etc.
 */
export class ConflictError extends AppError {
  constructor(message = 'Conflict', details?: unknown) {
    super(message, { statusCode: 409, code: 'CONFLICT', details });
  }
}
