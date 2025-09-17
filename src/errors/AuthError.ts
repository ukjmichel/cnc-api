import { AppError } from './AppError.js';

/**
 * Authentication failure (401).
 */
export class AuthError extends AppError {
  constructor(message = 'Unauthorized', details?: unknown) {
    super(message, { statusCode: 401, code: 'UNAUTHORIZED', details });
  }
}
