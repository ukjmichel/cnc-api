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
 *  - Creation writes to AuthorizationModel (default `"user"` or `"employee"`); the controller
 *    returns it under `authorization.role`.
 *
 * Role handling
 *  - Accepts query params: `?authRole=` (canonical) or `?role=` (alias) which the query builders
 *    translate into DB-side filters via AuthorizationModel.
 *
 * Endpoints
 *  - POST   /api/users                   → create (authorization role = "user" by default, TX)
 *  - POST   /api/users/employee          → create with authorization role = "employee" (TX)
 *  - GET    /api/users                   → list (q + sort + pagination; DB-side role filter)
 *  - GET    /api/users/filter            → filter (advanced filters + q; DB-side role filter)
 *  - GET    /api/users/by-email          → getByEmail (?email=)
 *  - GET    /api/users/by-username       → getByUsername (?username=)
 *  - GET    /api/users/:id               → getById
 *  - PATCH  /api/users/:id               → update (profile fields, no password)
 *  - PATCH  /api/users/:id/password      → changePassword
 *  - PATCH  /api/users/:id/verified      → setVerified
 *  - PATCH  /api/users/:id/role          → setRole (AuthorizationModel)
 *  - DELETE /api/users/:id               → delete (and cleanup AuthorizationModel)
 *
 * Notes
 *  - Business logic lives in UserService; this controller only wraps/normalizes responses.
 *  - Transactions for create endpoints keep behavior consistent with the service layer.
 *  - Query builders live in src/queries/user.queries.ts.
 * =============================================================================
 */

import type { Request, Response, NextFunction } from 'express';
import { Transaction } from 'sequelize';

import { UserService } from '../services/user.service.js';
import { sequelize } from '../db/sequelize.js';
import { UserModel } from '../models/user.model.js';
import { AuthorizationModel } from '../models/authorization.model.js';

import type {
  CreateUserDTO,
  UpdateUserDTO,
  ChangePasswordDTO,
} from '../types/user.js';

import {
  buildUserListQuery,
  buildUserFilterQuery,
} from '../queries/user.queries.js';
import {
  serializeUserForResponse,
  serializeUsers,
} from '../serializers/user.serializer.js';

export class UserController {
  // ========= CREATE (TX) =========

  /**
   * Create a new user with the default authorization role `"user"`.
   *
   * @route POST /api/users
   * @auth Public (or guarded upstream)
   * @param req Express request (body: {@link CreateUserDTO})
   * @param res Express response
   * @param next Error handler
   * @returns 201 Created — `{ data: { user } }`
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
        // Create base user
        const user = await UserModel.create(
          {
            username: payload.username,
            firstName: payload.firstName,
            lastName: payload.lastName,
            email: payload.email,
            password: payload.password,
          } as any,
          { transaction: t }
        );

        // Create default authorization: role = "user"
        const role: 'user' = 'user';
        await AuthorizationModel.create(
          { userId: user.userId, role },
          { transaction: t }
        );

        // Return user with `authorization` inline (controller will normalize)
        return { ...user.toJSON(), authorization: { role } };
      });

      return res
        .status(201)
        .json({ data: { user: serializeUserForResponse(result) } });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * Create a new employee with authorization role `"employee"`.
   *
   * @route POST /api/users/employee
   * @auth Admin-only (enforced by middleware)
   * @param req Express request (body: {@link CreateUserDTO})
   * @param res Express response
   * @param next Error handler
   * @returns 201 Created — `{ data: { user } }`
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
          } as any,
          { transaction: t }
        );

        // Create authorization: role = "employee"
        const role: 'employee' = 'employee';
        await AuthorizationModel.create(
          { userId: user.userId, role },
          { transaction: t }
        );

        return { ...user.toJSON(), authorization: { role } };
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
   * @param req Express request (path: `id`)
   * @param res Express response
   * @param next Error handler
   * @returns 200 OK — `{ data: { user } }`
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
   * @param req Express request (query: `email`)
   * @param res Express response
   * @param next Error handler
   * @returns 200 OK — `{ data: { user } }`
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
   * @param req Express request (query: `username`)
   * @param res Express response
   * @param next Error handler
   * @returns 200 OK — `{ data: { user } }`
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
   * Role filtering is **DB-side** via `?authRole=` (canonical) or `?role=` (alias).
   *
   * @route GET /api/users
   * @param req Express request (query: q, page, pageSize, sort, authRole/role)
   * @param res Express response
   * @param next Error handler
   * @returns 200 OK — `{ data: { users }, meta: { total, page, pageSize, pages } }`
   *
   * @errors
   * - 400 Invalid query
   * - 500 Internal error
   */
  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const query = buildUserListQuery(req.query as Record<string, unknown>);
      const result = await UserService.list(query);

      // Users are already filtered/paginated at the DB layer.
      const normalized = serializeUsers(result.users as any[]);

      return res.json({
        data: { users: normalized },
        meta: {
          total: result.total,
          page: result.page,
          pageSize: result.pageSize,
          pages: result.pages,
        },
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * Advanced filter endpoint (server-side structured filters + `q`).
   * Supports the same DB-side role filter as `list` (`?authRole=` / `?role=`).
   *
   * @route GET /api/users/filter
   * @param req Express request (query: filters JSON or individual fields)
   * @param res Express response
   * @param next Error handler
   * @returns 200 OK — `{ data: { users }, meta: { total, page, pageSize, pages } }`
   *
   * @errors
   * - 400 Invalid filters
   * - 500 Internal error
   */
  static async filter(req: Request, res: Response, next: NextFunction) {
    try {
      const query = buildUserFilterQuery(req.query as Record<string, unknown>);
      const result = await UserService.filter(query);

      const normalized = serializeUsers(result.users as any[]);

      return res.json({
        data: { users: normalized },
        meta: {
          total: result.total,
          page: result.page,
          pageSize: result.pageSize,
          pages: result.pages,
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
   * @param req Express request (path: `id`, body: {@link UpdateUserDTO})
   * @param res Express response
   * @param next Error handler
   * @returns 200 OK — `{ data: { user } }`
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
   * @param req Express request (path: `id`, body: {@link ChangePasswordDTO})
   * @param res Express response
   * @param next Error handler
   * @returns 200 OK — `{ data: { success: true } }`
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
   * @param req Express request (path: `id`, body: `{ verified: boolean }`)
   * @param res Express response
   * @param next Error handler
   * @returns 200 OK — `{ data: { user } }`
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
   * Delete a user and cleanup their authorization.
   *
   * @route DELETE /api/users/:id
   * @param req Express request (path: `id`)
   * @param res Express response
   * @param next Error handler
   * @returns 200 OK — `{ data: { success: true } }`
   *
   * @remarks
   * - Calls service to delete the user row.
   * - Then removes AuthorizationModel rows referencing the userId (best-effort cleanup).
   *
   * @errors
   * - 403 Forbidden
   * - 404 Not Found
   * - 500 Internal error
   */
  static async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const out = await UserService.delete(req.params.id);
      // Best-effort cleanup of authorization (outside service per your request to keep service unchanged)
      await AuthorizationModel.destroy({ where: { userId: req.params.id } });
      return res.json({ data: out });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * Set a user's role (AuthorizationModel).
   *
   * @route PATCH /api/users/:id/role
   * @auth Employee/Admin (middleware)
   * @param req Express request (path: `id`, body: `{ role: "user"|"employee"|"administrator" }`)
   * @param res Express response
   * @param next Error handler
   * @returns 200 OK — `{ data: { user } }` with `authorization: { role }`
   *
   * @errors
   * - 400 Invalid body
   * - 403 Forbidden
   * - 404 Not Found
   * - 500 Internal error
   */
  static async setRole(req: Request, res: Response, next: NextFunction) {
    try {
      const { role } = req.body as {
        role: 'user' | 'employee' | 'administrator';
      };
      if (!role || !['user', 'employee', 'administrator'].includes(role)) {
        return res.status(400).json({ error: 'Invalid role' });
      }

      const user = await UserService.setRole(req.params.id, role);
      return res.json({ data: { user } });
    } catch (err) {
      return next(err);
    }
  }
}
