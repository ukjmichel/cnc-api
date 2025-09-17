import { AppError } from './AppError.js';

/**
 * Forbidden (authenticated but not allowed) (403).
 */
export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', details?: unknown) {
    super(message, { statusCode: 403, code: 'FORBIDDEN', details });
  }
}
