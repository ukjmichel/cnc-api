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
  ListUsersQuery,
  UserFilters,
  StringMatch,
} from '../types/user.js';

/** Role union (must match your UserModel's `role` column). */
type Role = 'user' | 'employee' | 'administrator';

/** Allowed ordering fields for list/filter endpoints. */
const ORDER_FIELDS = new Set([
  'createdAt',
  'updatedAt',
  'username',
  'firstName',
  'lastName',
  'email',
  'role', // allow sorting by role if desired
]);

type OrderDir = 'ASC' | 'DESC';
const ROLES: Role[] = ['user', 'employee', 'administrator'];

/** Convert arbitrary value to a positive integer with a default. */
function toInt(v: unknown, def: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : def;
}

/** Normalize orderBy (whitelist) and orderDir. */
function normalizeSort(
  orderBy?: string,
  orderDir?: string
): {
  orderBy: NonNullable<ListUsersQuery['orderBy']>;
  orderDir: OrderDir;
} {
  const ob = ORDER_FIELDS.has(String(orderBy)) ? (orderBy as any) : 'createdAt';
  const dir = String(orderDir || '').toUpperCase();
  const od: OrderDir =
    dir === 'ASC' || dir === 'DESC' ? (dir as OrderDir) : 'DESC';
  return { orderBy: ob, orderDir: od };
}

/** Read a query parameter that may be string or string[] and return string[] */
function qsArray(v: unknown): string[] | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v.map(String) : [String(v)];
}

/** Parse "true"/"false" to boolean when present. */
function qsBool(v: unknown): boolean | undefined {
  if (v === undefined) return undefined;
  if (typeof v === 'boolean') return v;
  const s = String(v).toLowerCase();
  if (s === 'true') return true;
  if (s === 'false') return false;
  return undefined;
}

/** Parse & validate role filter (or undefined). */
function qsRole(v: unknown): Role | undefined {
  if (typeof v !== 'string') return undefined;
  const r = v.toLowerCase() as Role;
  return ROLES.includes(r) ? r : undefined;
}

/** Build ListUsersQuery for basic list (free-text only). */
function buildListQuery(req: Request): ListUsersQuery {
  const { page, pageSize, q, orderBy, orderDir } = req.query;
  const sort = normalizeSort(
    orderBy as string | undefined,
    orderDir as string | undefined
  );

  return {
    page: toInt(page, 1),
    pageSize: toInt(pageSize, 20),
    q: typeof q === 'string' ? q : undefined,
    orderBy: sort.orderBy,
    orderDir: sort.orderDir,
  };
}

/** Build ListUsersQuery for advanced filter endpoint. */
function buildFilterQuery(req: Request): ListUsersQuery {
  const { page, pageSize, q, orderBy, orderDir, match } = req.query;
  const sort = normalizeSort(
    orderBy as string | undefined,
    orderDir as string | undefined
  );

  // Accept either a JSON string in ?filters=... or individual query params.
  let filters: UserFilters | undefined;

  if (typeof req.query.filters === 'string' && req.query.filters.trim()) {
    try {
      const parsed = JSON.parse(req.query.filters) as UserFilters;
      filters = parsed;
    } catch {
      // ignore bad JSON; fallback to individual params below
    }
  }

  if (!filters) {
    filters = {
      userId: qsArray(req.query.userId),
      username: qsArray(req.query.username),
      firstName: qsArray(req.query.firstName),
      lastName: qsArray(req.query.lastName),
      email: qsArray(req.query.email),
      verified: qsBool(req.query.verified),
      createdAtFrom:
        typeof req.query.createdAtFrom === 'string'
          ? req.query.createdAtFrom
          : undefined,
      createdAtTo:
        typeof req.query.createdAtTo === 'string'
          ? req.query.createdAtTo
          : undefined,
      updatedAtFrom:
        typeof req.query.updatedAtFrom === 'string'
          ? req.query.updatedAtFrom
          : undefined,
      updatedAtTo:
        typeof req.query.updatedAtTo === 'string'
          ? req.query.updatedAtTo
          : undefined,
      match:
        (typeof match === 'string' ? (match as StringMatch) : undefined) ??
        'like',
    };
  } else if (!filters.match) {
    filters.match =
      (typeof match === 'string' ? (match as StringMatch) : undefined) ??
      'like';
  }

  return {
    page: toInt(page, 1),
    pageSize: toInt(pageSize, 20),
    q: typeof q === 'string' ? q : undefined,
    filters,
    orderBy: sort.orderBy,
    orderDir: sort.orderDir,
  };
}

/**
 * Normalize a user object for API responses.
 *
 * Ensures the shape:
 * {
 *   userId: string,
 *   username: string,
 *   firstName: string,
 *   lastName: string,
 *   email: string,
 *   verified: boolean,
 *   createdAt: string | Date,
 *   updatedAt: string | Date,
 *   authorization: { role: "user" | "employee" | "administrator" } | null
 * }
 *
 * - Removes any top-level `role` from the user row.
 * - If input already has `authorization.role`, it is respected.
 * - If input only has `role`, it is moved to `authorization.role`.
 *
 * @template T extends Record<string, any>
 * @param {T} u - Plain user object from service/model (may include role/authorization)
 * @returns {T & { authorization: { role: string } | null }} normalized user object
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
 * @param {T[]} users - Array of user objects
 * @returns {(T & { authorization: { role: string } | null })[]} normalized users
 */
function serializeUsers<T extends Record<string, any>>(users: T[]) {
  return users.map(serializeUserForResponse);
}

export class UserController {
  // ========= CREATE (TX) =========

  /**
   * POST /api/users
   * Create a user with default role "user" in a single transaction.
   *
   * @param {Request} req - Express request (body: CreateUserDTO)
   * @param {Response} res - Express response
   * @param {NextFunction} next - Error handler
   * @returns {Promise<void>} 201 + { data: { user } }
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
            role: 'user', // default
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
   * POST /api/users/employee
   * Create a user with role "employee" in a single transaction.
   *
   * @param {Request} req - Express request (body: CreateUserDTO)
   * @param {Response} res - Express response
   * @param {NextFunction} next - Error handler
   * @returns {Promise<void>} 201 + { data: { user } }
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
   * GET /api/users/:id
   * Fetch a single user by ID.
   *
   * @param {Request} req - Express request (params.id)
   * @param {Response} res - Express response
   * @param {NextFunction} next - Error handler
   * @returns {Promise<void>} 200 + { data: { user } }
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
   * GET /api/users/by-email?email=...
   * Fetch a single user by email.
   *
   * @param {Request} req - Express request (query.email)
   * @param {Response} res - Express response
   * @param {NextFunction} next - Error handler
   * @returns {Promise<void>} 200 + { data: { user } }
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
   * GET /api/users/by-username?username=...
   * Fetch a single user by username.
   *
   * @param {Request} req - Express request (query.username)
   * @param {Response} res - Express response
   * @param {NextFunction} next - Error handler
   * @returns {Promise<void>} 200 + { data: { user } }
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
   * GET /api/users
   * Paginated list with optional free-text `q` and controller-side role filter `?role=`.
   *
   * @param {Request} req - Express request (query: page, pageSize, q, orderBy, orderDir, role)
   * @param {Response} res - Express response
   * @param {NextFunction} next - Error handler
   * @returns {Promise<void>} 200 + { data: { users }, meta }
   */
  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const role = qsRole(req.query.role);
      const query = buildListQuery(req);

      const result = await UserService.list(query);

      // Normalize users to { authorization: { role }, ...no top-level role }
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
   *
   * @param {Request} req - Express request (query: page, pageSize, q, filters|individuals, orderBy, orderDir, role)
   * @param {Response} res - Express response
   * @param {NextFunction} next - Error handler
   * @returns {Promise<void>} 200 + { data: { users }, meta }
   */
  static async filter(req: Request, res: Response, next: NextFunction) {
    try {
      const role = qsRole(req.query.role);
      const query = buildFilterQuery(req);

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
   * PATCH /api/users/:id
   * Update profile fields (no password), returns normalized user.
   *
   * @param {Request} req - Express request (params.id, body: UpdateUserDTO)
   * @param {Response} res - Express response
   * @param {NextFunction} next - Error handler
   * @returns {Promise<void>} 200 + { data: { user } }
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
   * PATCH /api/users/:id/password
   * Change a user's password.
   *
   * @param {Request} req - Express request (params.id, body: ChangePasswordDTO)
   * @param {Response} res - Express response
   * @param {NextFunction} next - Error handler
   * @returns {Promise<void>} 200 + { data: { success: true } }
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
   * PATCH /api/users/:id/verified
   * Set a user's verified flag.
   *
   * @param {Request} req - Express request (params.id, body: { verified: boolean })
   * @param {Response} res - Express response
   * @param {NextFunction} next - Error handler
   * @returns {Promise<void>} 200 + { data: { user } }
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
   * DELETE /api/users/:id
   * Remove a user.
   *
   * @param {Request} req - Express request (params.id)
   * @param {Response} res - Express response
   * @param {NextFunction} next - Error handler
   * @returns {Promise<void>} 200 + { data: { success: true } }
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
