/**
 * =============================================================================
 * AppError — Base class for operational errors
 * =============================================================================
 * Adds HTTP status, machine code, and optional details to standard Error.
 * All domain errors should extend this class.
 * =============================================================================
 */
export class AppError extends Error {
  /** HTTP status code to return. */
  public readonly statusCode: number;

  /** Machine-readable error code. */
  public readonly code?: string;

  /** Additional structured error info (optional). */
  public readonly details?: unknown;

  /** Flag for distinguishing operational vs. programmer errors. */
  public readonly isOperational = true;

  constructor(
    message: string,
    options?: {
      statusCode?: number;
      code?: string;
      details?: unknown;
    }
  ) {
    super(message);
    this.name = new.target.name;
    this.statusCode = options?.statusCode ?? 500;
    this.code = options?.code;
    this.details = options?.details;

    // Maintains proper stack trace (V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, new.target);
    }
  }

  /** JSON representation (useful if ever serialized). */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      statusCode: this.statusCode,
      code: this.code,
      details: this.details,
    };
  }
}
