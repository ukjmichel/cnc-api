// src/middlewares/errorHandler.ts
import type { Request, Response, NextFunction } from 'express';
import {
  UniqueConstraintError,
  ValidationError as SequelizeValidationError,
  ForeignKeyConstraintError,
  DatabaseError,
} from 'sequelize';

/**
 * =============================================================================
 * Global Error Handler (Express)
 * =============================================================================
 * Use as the **last** middleware:
 *   app.use(errorHandler);
 *
 * Responsibilities
 *  - Normalizes known domain errors (BadRequestError, NotFoundError, etc.)
 *  - Maps common library errors (Sequelize, JWT) to HTTP responses
 *  - Sends a consistent JSON payload:
 *      {
 *        status: <http code>,
 *        error:  <machine code>,
 *        message:<human message>,
 *        details?: <extra>,
 *        stack?: <dev only>
 *      }
 *  - Avoids leaking stack traces in production
 * =============================================================================
 */

type AnyError = Error & {
  status?: number;
  statusCode?: number; // ← Added support for statusCode
  code?: string;
  details?: unknown;
  isOperational?: boolean; // ← Added support for isOperational flag
  // for Sequelize
  errors?: Array<{ message: string; path?: string | null; value?: unknown }>;
  fields?: Record<string, unknown>;
  parent?: unknown;
  // for JWT libs
  name?: string;
};

const isProd = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

/** Map a thrown error → { status, error, message, details } */
function normalize(err: AnyError) {
  // 1) Custom domain errors that set `status` or `statusCode` (e.g., BadRequestError, NotFoundError...)
  const httpStatus = err.statusCode || err.status;
  if (typeof httpStatus === 'number') {
    return {
      status: httpStatus,
      error: err.code || codeFromStatus(httpStatus) || 'ERROR',
      message: err.message || 'Error',
      details: err.details,
    };
  }

  // 2) Sequelize
  if (err instanceof UniqueConstraintError) {
    return {
      status: 409,
      error: 'DUPLICATE',
      message: err.message || 'Duplicate value violates a unique constraint.',
      details: err.errors?.map((e) => ({
        path: e.path,
        message: e.message,
        value: e.value,
      })),
    };
  }
  if (err instanceof SequelizeValidationError) {
    return {
      status: 400,
      error: 'VALIDATION_ERROR',
      message: 'Validation failed.',
      details: err.errors?.map((e) => ({
        path: e.path,
        message: e.message,
        value: e.value,
      })),
    };
  }
  if (err instanceof ForeignKeyConstraintError) {
    return {
      status: 409,
      error: 'FK_CONSTRAINT',
      message: 'Operation violates a foreign key constraint.',
      details: {
        table: err.table,
        fields: err.fields,
        index: err.index,
      },
    };
  }
  if (err instanceof DatabaseError) {
    return {
      status: 500,
      error: 'DB_ERROR',
      message: 'A database error occurred.',
      details: { parent: (err as any).parent },
    };
  }

  // 3) JWT errors (no hard import; detect by name)
  if (err.name === 'TokenExpiredError') {
    return {
      status: 401,
      error: 'TOKEN_EXPIRED',
      message: 'Authentication token has expired.',
    };
  }
  if (err.name === 'JsonWebTokenError') {
    return {
      status: 401,
      error: 'INVALID_TOKEN',
      message: 'Invalid authentication token.',
    };
  }

  // 4) Fallback
  return {
    status: 500,
    error: 'INTERNAL_SERVER_ERROR',
    message: err.message || 'Something went wrong.',
  };
}

/** Best-effort mapping when a custom error only sets `status` or `statusCode` */
function codeFromStatus(status: number) {
  switch (status) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 422:
      return 'UNPROCESSABLE_ENTITY';
    case 429:
      return 'TOO_MANY_REQUESTS';
    case 500:
      return 'INTERNAL_SERVER_ERROR';
    default:
      return undefined;
  }
}

/**
 * Express error-handling middleware.
 * MUST be registered after all routes and other middleware.
 */
export function errorHandler(
  err: AnyError,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  // Only log in non-test environments to avoid cluttering test output
  if (!isTest) {
    // Log with basic request context
    // You can replace with a proper logger (pino/winston) if available.
    // eslint-disable-next-line no-console
    console.error(
      `[${new Date().toISOString()}] ${req.method} ${req.originalUrl}\n`,
      err
    );
  }

  const norm = normalize(err);

  // Don't double-send if headers already committed
  if (res.headersSent) {
    return res.end();
  }

  const payload: Record<string, unknown> = {
    status: norm.status,
    error: norm.error,
    message: norm.message,
  };

  if (norm.details !== undefined) payload.details = norm.details;

  // Only expose stack in non-production
  if (!isProd && err.stack) payload.stack = err.stack;

  return res.status(norm.status).json(payload);
}

/**
 * Optional 404 "not found" handler for unmatched routes.
 * Place this BEFORE errorHandler, AFTER all routers:
 *   app.use(notFoundHandler);
 */
export function notFoundHandler(req: Request, res: Response) {
  return res.status(404).json({
    status: 404,
    error: 'NOT_FOUND',
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
}
