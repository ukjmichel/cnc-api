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
 */
function serializeUserForResponse<T extends Record<string, any>>(u: T) {
  if (!u) return u as any;
  const role = u.role ?? u.authorization?.role ?? null;
  const { role: _omitRole, authorization: _omitAuth, ...rest } = u;
  return { ...rest, authorization: role ? { role } : null } as T & {
    authorization: { role: string } | null;
  };
}

/** Normalize an array of users for API responses. */
function serializeUsers<T extends Record<string, any>>(users: T[]) {
  return users.map(serializeUserForResponse);
}

export class UserController {
  // ========= CREATE (TX) =========

  /** POST /api/users — Create with default role "user" */
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

  /** POST /api/users/employee — Create with role "employee" */
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

  /** GET /api/users/:id */
  static async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await UserService.getById(req.params.id);
      return res.json({ data: { user: serializeUserForResponse(user) } });
    } catch (err) {
      return next(err);
    }
  }

  /** GET /api/users/by-email?email=... */
  static async getByEmail(req: Request, res: Response, next: NextFunction) {
    try {
      const email = String(req.query.email ?? '');
      const user = await UserService.getByEmail(email);
      return res.json({ data: { user: serializeUserForResponse(user) } });
    } catch (err) {
      return next(err);
    }
  }

  /** GET /api/users/by-username?username=... */
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
   * GET /api/users
   * Paginated list with optional free-text `q` and controller-side role filter `?role=`.
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
   * GET /api/users/filter
   * Advanced filter + free-text `q`, with optional controller-side role filter `?role=`.
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

  /** PATCH /api/users/:id */
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

  /** PATCH /api/users/:id/password */
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

  /** PATCH /api/users/:id/verified */
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

  /** DELETE /api/users/:id */
  static async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const out = await UserService.delete(req.params.id);
      return res.json({ data: out });
    } catch (err) {
      return next(err);
    }
  }
}
