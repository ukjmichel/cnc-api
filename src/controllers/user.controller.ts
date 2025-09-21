// src/controllers/user.controller.ts

/**
 * =============================================================================
 * UserController — HTTP layer for user accounts
 * =============================================================================
 * Response shape (normalized)
 *  - Single entity:        { data: { user } }
 *  - Collections (list):   { data: { users }, meta: { total, page, pageSize, pages } }
 *  - Utility/success-only: { data: { success: true } }
 *
 * Important:
 *  - We **do not** expose a top-level `role` on users.
 *  - Instead, every user has: `authorization: { role: "user"|"employee"|"administrator" } | null`
 *  - Creation still writes `role` on the UserModel; the controller strips it from responses.
 *
 * Role handling
 *  - Accepts query param: ?role=user|employee|administrator (controller-side filter on response).
 *
 * Endpoints
 *  - POST   /api/users                   → create (role = "user" by default, TX)
 *  - POST   /api/users/employee          → create with role = "employee" (TX)
 *  - GET    /api/users                   → list (q + sort + pagination; ?role= filter)
 *  - GET    /api/users/filter            → filter (advanced filters + q; ?role= filter)
 *  - GET    /api/users/by-email          → getByEmail (?email=)
 *  - GET    /api/users/by-username       → getByUsername (?username=)
 *  - GET    /api/users/:id               → getById
 *  - PATCH  /api/users/:id               → update (profile fields, no password)
 *  - PATCH  /api/users/:id/password      → changePassword
 *  - PATCH  /api/users/:id/verified      → setVerified
 *  - DELETE /api/users/:id               → delete
 *
 * Notes
 *  - Business logic lives in UserService; this controller only wraps/normalizes responses.
 *  - Transactions for create endpoints keep behavior consistent with service layer.
 *  - Query builders moved to src/queries/user.queries.ts
 * =============================================================================
 */

import type { Request, Response, NextFunction } from 'express';
import { Transaction } from 'sequelize';

import { UserService } from '../services/user.service.js';
import { sequelize } from '../db/sequelize.js';
import { UserModel } from '../models/user.model.js';

import type {
  CreateUserDTO,
  UpdateUserDTO,
  ChangePasswordDTO,
} from '../types/user.js';

import {
  buildUserListQuery,
  buildUserFilterQuery,
  qsRole,
} from '../queries/user.queries.js';

/**
 * Normalize a user object for API responses.
 *
 * Ensures the shape:
 * {
 *   userId, username, firstName, lastName, email, verified, createdAt, updatedAt,
 *   authorization: { role } | null
 * }
 *
 * - Removes any top-level `role` from the user row.
 * - If input already has `authorization.role`, it is respected.
 * - If input only has `role`, it is moved to `authorization.role`.
 *
 * @template T extends Record<string, any>
 * @param {T} u - Raw user row/object (e.g., Sequelize JSON).
 * @returns {T & { authorization: { role: string } | null }} Normalized user object.
 */
function serializeUserForResponse<T extends Record<string, any>>(u: T) {
  if (!u) return u as any;
  const role = u.role ?? u.authorization?.role ?? null;
  const { role: _omitRole, authorization: _omitAuth, ...rest } = u;
  return { ...rest, authorization: role ? { role } : null } as T & {
    authorization: { role: string } | null;
  };
}

/**
 * Normalize an array of users for API responses.
 *
 * @template T extends Record<string, any>
 * @param {T[]} users - Array of user rows/objects.
 * @returns {(T & { authorization: { role: string } | null })[]} Normalized users.
 */
function serializeUsers<T extends Record<string, any>>(users: T[]) {
  return users.map(serializeUserForResponse);
}

export class UserController {
  // ========= CREATE (TX) =========

  /**
   * Create a new user with the default role `"user"`.
   *
   * @route POST /api/users
   * @auth Public (or guarded upstream)
   *
   * @param {Request} req - Express request.
   * @param {Response} res - Express response.
   * @param {NextFunction} next - Error handler.
   *
   * @body {CreateUserDTO} req.body
   * @returns {Promise<void>} 201 Created — `{ data: { user } }`
   *
   * @example
   * // Request body
   * {
   *   "username": "alice",
   *   "firstName": "Alice",
   *   "lastName": "Doe",
   *   "email": "alice@example.com",
   *   "password": "secret123"
   * }
   *
   * @errors
   * - 400 Validation error
   * - 409 Conflict (duplicate email/username)
   * - 500 Internal error
   */
  static async create(req: Request, res: Response, next: NextFunction) {
    const payload = req.body as CreateUserDTO;

    try {
      const result = await sequelize.transaction(async (t: Transaction) => {
        const user = await UserModel.create(
          {
            username: payload.username,
            firstName: payload.firstName,
            lastName: payload.lastName,
            email: payload.email,
            password: payload.password,
            role: 'user',
          } as any,
          { transaction: t }
        );
        return user.toJSON();
      });

      return res
        .status(201)
        .json({ data: { user: serializeUserForResponse(result) } });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * Create a new employee with role `"employee"`.
   *
   * @route POST /api/users/employee
   * @auth Admin-only (enforced by middleware)
   *
   * @param {Request} req - Express request.
   * @param {Response} res - Express response.
   * @param {NextFunction} next - Error handler.
   *
   * @body {CreateUserDTO} req.body
   * @returns {Promise<void>} 201 Created — `{ data: { user } }`
   *
   * @errors
   * - 400 Validation error
   * - 403 Forbidden
   * - 409 Conflict
   * - 500 Internal error
   */
  static async createEmployee(req: Request, res: Response, next: NextFunction) {
    const payload = req.body as CreateUserDTO;

    try {
      const result = await sequelize.transaction(async (t: Transaction) => {
        const user = await UserModel.create(
          {
            username: payload.username,
            firstName: payload.firstName,
            lastName: payload.lastName,
            email: payload.email,
            password: payload.password,
            role: 'employee',
          } as any,
          { transaction: t }
        );
        return user.toJSON();
      });

      return res
        .status(201)
        .json({ data: { user: serializeUserForResponse(result) } });
    } catch (err) {
      return next(err);
    }
  }

  // ========= READS =========

  /**
   * Get a user by ID.
   *
   * @route GET /api/users/:id
   * @auth Protected (middleware)
   *
   * @param {Request} req - Express request.
   * @param {Response} res - Express response.
   * @param {NextFunction} next - Error handler.
   * @pathParam {string} req.params.id - User ID.
   * @returns {Promise<void>} 200 OK — `{ data: { user } }`
   *
   * @errors
   * - 404 Not Found
   * - 500 Internal error
   */
  static async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await UserService.getById(req.params.id);
      return res.json({ data: { user: serializeUserForResponse(user) } });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * Get a user by email.
   *
   * @route GET /api/users/by-email?email={email}
   *
   * @param {Request} req - Express request.
   * @param {Response} res - Express response.
   * @param {NextFunction} next - Error handler.
   * @query {string} email - Email address.
   * @returns {Promise<void>} 200 OK — `{ data: { user } }`
   *
   * @errors
   * - 400 Missing/invalid email
   * - 404 Not Found
   * - 500 Internal error
   */
  static async getByEmail(req: Request, res: Response, next: NextFunction) {
    try {
      const email = String(req.query.email ?? '');
      const user = await UserService.getByEmail(email);
      return res.json({ data: { user: serializeUserForResponse(user) } });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * Get a user by username.
   *
   * @route GET /api/users/by-username?username={username}
   *
   * @param {Request} req - Express request.
   * @param {Response} res - Express response.
   * @param {NextFunction} next - Error handler.
   * @query {string} username - Username.
   * @returns {Promise<void>} 200 OK — `{ data: { user } }`
   *
   * @errors
   * - 400 Missing/invalid username
   * - 404 Not Found
   * - 500 Internal error
   */
  static async getByUsername(req: Request, res: Response, next: NextFunction) {
    try {
      const username = String(req.query.username ?? '');
      const user = await UserService.getByUsername(username);
      return res.json({ data: { user: serializeUserForResponse(user) } });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * List users with pagination and optional free-text query.
   * A controller-side role filter can be applied via `?role=user|employee|administrator`.
   *
   * @route GET /api/users
   *
   * @param {Request} req - Express request.
   * @param {Response} res - Express response.
   * @param {NextFunction} next - Error handler.
   *
   * @query {string} [q] - Free-text search.
   * @query {string} [sort] - Sort string (e.g., "createdAt:desc").
   * @query {number} [page=1] - Page number.
   * @query {number} [pageSize=20] - Page size.
   * @query {"user"|"employee"|"administrator"} [role] - Controller-side filter.
   *
   * @returns {Promise<void>} 200 OK — `{ data: { users }, meta: { total, page, pageSize, pages } }`
   *
   * @errors
   * - 400 Invalid query
   * - 500 Internal error
   */
  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const role = qsRole(req.query.role);
      const query = buildUserListQuery(req.query as Record<string, unknown>);

      const result = await UserService.list(query);

      const normalized = serializeUsers(result.users as any[]);
      const filtered = role
        ? normalized.filter((u: any) => u.authorization?.role === role)
        : normalized;

      return res.json({
        data: { users: filtered },
        meta: {
          total: role ? filtered.length : result.total,
          page: result.page,
          pageSize: result.pageSize,
          pages: role
            ? Math.max(1, Math.ceil(filtered.length / result.pageSize))
            : result.pages,
        },
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * Advanced filter endpoint (server-side structured filters + `q`).
   * Supports the same controller-side role filter as `list`.
   *
   * @route GET /api/users/filter
   *
   * @param {Request} req - Express request.
   * @param {Response} res - Express response.
   * @param {NextFunction} next - Error handler.
   *
   * @returns {Promise<void>} 200 OK — `{ data: { users }, meta: { total, page, pageSize, pages } }`
   *
   * @errors
   * - 400 Invalid filters
   * - 500 Internal error
   */
  static async filter(req: Request, res: Response, next: NextFunction) {
    try {
      const role = qsRole(req.query.role);
      const query = buildUserFilterQuery(req.query as Record<string, unknown>);

      const result = await UserService.filter(query);

      const normalized = serializeUsers(result.users as any[]);
      const filtered = role
        ? normalized.filter((u: any) => u.authorization?.role === role)
        : normalized;

      return res.json({
        data: { users: filtered },
        meta: {
          total: role ? filtered.length : result.total,
          page: result.page,
          pageSize: result.pageSize,
          pages: role
            ? Math.max(1, Math.ceil(filtered.length / result.pageSize))
            : result.pages,
        },
      });
    } catch (err) {
      return next(err);
    }
  }

  // ========= MUTATIONS =========

  /**
   * Update profile fields (no password change).
   *
   * @route PATCH /api/users/:id
   *
   * @param {Request} req - Express request.
   * @param {Response} res - Express response.
   * @param {NextFunction} next - Error handler.
   * @pathParam {string} req.params.id - User ID.
   * @body {UpdateUserDTO} req.body
   * @returns {Promise<void>} 200 OK — `{ data: { user } }`
   *
   * @errors
   * - 400 Validation error
   * - 403 Forbidden
   * - 404 Not Found
   * - 500 Internal error
   */
  static async update(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await UserService.update(
        req.params.id,
        req.body as UpdateUserDTO
      );
      return res.json({ data: { user: serializeUserForResponse(user) } });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * Change a user's password.
   *
   * @route PATCH /api/users/:id/password
   *
   * @param {Request} req - Express request.
   * @param {Response} res - Express response.
   * @param {NextFunction} next - Error handler.
   * @pathParam {string} req.params.id - User ID.
   * @body {ChangePasswordDTO} req.body
   * @returns {Promise<void>} 200 OK — `{ data: { success: true } }`
   *
   * @errors
   * - 400 Validation error or weak password
   * - 403 Forbidden / invalid current password
   * - 404 Not Found
   * - 500 Internal error
   */
  static async changePassword(req: Request, res: Response, next: NextFunction) {
    try {
      const out = await UserService.changePassword(
        req.params.id,
        req.body as ChangePasswordDTO
      );
      return res.json({ data: out });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * Set a user's verification status.
   *
   * @route PATCH /api/users/:id/verified
   *
   * @param {Request} req - Express request.
   * @param {Response} res - Express response.
   * @param {NextFunction} next - Error handler.
   * @pathParam {string} req.params.id - User ID.
   * @body {{ verified: boolean }} req.body
   * @returns {Promise<void>} 200 OK — `{ data: { user } }`
   *
   * @errors
   * - 400 Invalid body
   * - 403 Forbidden
   * - 404 Not Found
   * - 500 Internal error
   */
  static async setVerified(req: Request, res: Response, next: NextFunction) {
    try {
      const { verified } = req.body as { verified: boolean };
      const user = await UserService.setVerified(
        req.params.id,
        Boolean(verified)
      );
      return res.json({ data: { user: serializeUserForResponse(user) } });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * Delete a user.
   *
   * @route DELETE /api/users/:id
   *
   * @param {Request} req - Express request.
   * @param {Response} res - Express response.
   * @param {NextFunction} next - Error handler.
   * @pathParam {string} req.params.id - User ID.
   * @returns {Promise<void>} 200 OK — `{ data: { success: true } }`
   *
   * @errors
   * - 403 Forbidden
   * - 404 Not Found
   * - 500 Internal error
   */
  static async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const out = await UserService.delete(req.params.id);
      return res.json({ data: out });
    } catch (err) {
      return next(err);
    }
  }
}
