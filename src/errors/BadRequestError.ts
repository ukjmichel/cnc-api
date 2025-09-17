import { AppError } from './AppError.js';

/**
 * Bad request / invalid input (400).
 */
export class BadRequestError extends AppError {
  constructor(message = 'Bad request', details?: unknown) {
    super(message, { statusCode: 400, code: 'BAD_REQUEST', details });
  }
}
