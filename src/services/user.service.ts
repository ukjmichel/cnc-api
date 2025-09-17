/**
 * =============================================================================
 * UserService — Business Logic Layer for User Accounts
 * =============================================================================
 * Purpose
 *  - Encapsulates all operations around the `UserModel` (sequelize-typescript).
 *  - Returns **plain entities/collections**; controllers handle any `{ data: ... }` wrapping.
 *
 * Additions
 *  - Include authorization alongside users for list/filter.
 *  - Accept role-based filtering via `authRole` (single string or array).
 *  - list/filter return **flattened user objects** with `authorization: { role } | null`
 *    (only the role is exposed from AuthorizationModel).
 * =============================================================================
 */

import {
  Op,
  UniqueConstraintError,
  Transaction,
  type TransactionOptions,
} from 'sequelize';
import type { FindOptions, WhereOptions } from 'sequelize';

import type {
  CreateUserDTO,
  UpdateUserDTO,
  ChangePasswordDTO,
  ListUsersQuery,
  UserFilters,
  StringMatch,
} from '../types/user.js';

import { NotFoundError, DuplicateError, AuthError } from '../errors/index.js';
import { sequelize } from '../db/sequelize.js';
import { UserModel } from '../models/user.model.js';
import { AuthorizationModel } from '../models/authorization.model.js';

type Role = 'user' | 'employee' | 'administrator';

/**
 * Run a function inside a transaction and auto-commit/rollback.
 */
async function withTransaction<T>(
  work: (t: Transaction) => Promise<T>,
  options?: TransactionOptions
): Promise<T> {
  if (options) return sequelize.transaction(options, (t) => work(t));
  return sequelize.transaction((t) => work(t));
}

/** Normalize roles input to an array. */
function normalizeRoles(input?: Role | Role[]): Role[] | undefined {
  if (!input) return undefined;
  return Array.isArray(input) ? input : [input];
}

export class UserService {
  // ===== CRUD =====

  static async create(data: CreateUserDTO) {
    return withTransaction(async (t) => {
      try {
        const user = await UserModel.create(
          {
            username: data.username,
            firstName: data.firstName,
            lastName: data.lastName,
            email: data.email,
            password: data.password,
          },
          { transaction: t }
        );
        return user.toJSON();
      } catch (err: any) {
        if (err instanceof UniqueConstraintError) {
          throw new DuplicateError('Username or email already exists');
        }
        throw err;
      }
    });
  }

  static async getById(userId: string) {
    const user = await UserModel.findByPk(userId);
    if (!user) throw new NotFoundError('User not found');
    return user.toJSON();
  }

  /**
   * List users with optional role filter, and include each user's authorization (role only).
   *
   * Extended query:
   *  - authRole?: Role | Role[]
   *
   * Returns:
   *  {
   *    users: Array<User & { authorization: { role: Role } | null }>,
   *    total, page, pageSize, pages
   *  }
   */
  static async list(query: ListUsersQuery = {}) {
    const {
      page = 1,
      pageSize = 20,
      q,
      authRole,
      orderBy = 'createdAt',
      orderDir = 'DESC',
    } = query as ListUsersQuery & { authRole?: Role | Role[] };

    // Base WHERE from free-text
    let where = this.buildUserWhere(q, undefined);

    // Filter by role via Authorization table
    const roles = normalizeRoles(authRole);
    if (roles?.length) {
      const authRows = await AuthorizationModel.findAll({
        attributes: ['userId'],
        where: { role: { [Op.in]: roles } },
      });
      const ids = authRows.map((a) => a.userId);
      if (ids.length === 0) {
        return { users: [], total: 0, page, pageSize, pages: 1 };
      }
      where = {
        [Op.and]: [where, { userId: { [Op.in]: ids } }],
      } as WhereOptions;
    }

    const options: FindOptions = {
      where,
      limit: pageSize,
      offset: (page - 1) * pageSize,
      order: [[orderBy, orderDir]],
    };

    const { rows, count } = await UserModel.findAndCountAll(options);

    // Load auth rows for returned users and expose ONLY { role }
    const userIds = rows.map((u) => u.userId);
    const auths = userIds.length
      ? await AuthorizationModel.findAll({
          where: { userId: { [Op.in]: userIds } },
        })
      : [];
    const authMap = new Map<string, { role: Role }>(
      auths.map((a) => [a.userId, { role: a.role }])
    );

    return {
      users: rows.map((u) => ({
        ...u.toJSON(),
        authorization: authMap.get(u.userId) ?? null,
      })),
      total: count,
      page,
      pageSize,
      pages: Math.max(1, Math.ceil(count / pageSize)),
    };
  }

  /**
   * Filter users (advanced) with optional role filter, and include authorization (role only).
   *
   * Extended query:
   *  - authRole?: Role | Role[]
   *
   * Returns:
   *  {
   *    users: Array<User & { authorization: { role: Role } | null }>,
   *    total, page, pageSize, pages
   *  }
   */
  static async filter(query: ListUsersQuery = {}) {
    const {
      page = 1,
      pageSize = 20,
      q,
      filters,
      authRole,
      verified,
      orderBy = 'createdAt',
      orderDir = 'DESC',
    } = query as ListUsersQuery & {
      verified?: boolean;
      authRole?: Role | Role[];
    };

    const mergedFilters: UserFilters | undefined =
      typeof verified === 'boolean'
        ? { ...(filters ?? {}), verified }
        : filters;

    // Base WHERE from q + structured filters
    let where = this.buildUserWhere(q, mergedFilters);

    // Role filter via Authorization table
    const roles = normalizeRoles(authRole);
    if (roles?.length) {
      const authRows = await AuthorizationModel.findAll({
        attributes: ['userId'],
        where: { role: { [Op.in]: roles } },
      });
      const ids = authRows.map((a) => a.userId);
      if (ids.length === 0) {
        return { users: [], total: 0, page, pageSize, pages: 1 };
      }
      where = {
        [Op.and]: [where, { userId: { [Op.in]: ids } }],
      } as WhereOptions;
    }

    const options: FindOptions = {
      where,
      limit: pageSize,
      offset: (page - 1) * pageSize,
      order: [[orderBy, orderDir]],
    };

    const { rows, count } = await UserModel.findAndCountAll(options);

    // Load auth rows for returned users and expose ONLY { role }
    const userIds = rows.map((u) => u.userId);
    const auths = userIds.length
      ? await AuthorizationModel.findAll({
          where: { userId: { [Op.in]: userIds } },
        })
      : [];
    const authMap = new Map<string, { role: Role }>(
      auths.map((a) => [a.userId, { role: a.role }])
    );

    return {
      users: rows.map((u) => ({
        ...u.toJSON(),
        authorization: authMap.get(u.userId) ?? null,
      })),
      total: count,
      page,
      pageSize,
      pages: Math.max(1, Math.ceil(count / pageSize)),
    };
  }

  static async update(userId: string, updates: UpdateUserDTO) {
    return withTransaction(async (t) => {
      const user = await UserModel.findByPk(userId, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!user) throw new NotFoundError('User not found');

      const allowed: UpdateUserDTO = {};
      if (updates.username !== undefined) allowed.username = updates.username;
      if (updates.firstName !== undefined)
        allowed.firstName = updates.firstName;
      if (updates.lastName !== undefined) allowed.lastName = updates.lastName;
      if (updates.email !== undefined) allowed.email = updates.email;

      try {
        user.set(allowed);
        await user.save({ transaction: t });
        return user.toJSON();
      } catch (err: any) {
        if (err instanceof UniqueConstraintError) {
          throw new DuplicateError('Username or email already exists');
        }
        throw err;
      }
    });
  }

  static async delete(userId: string) {
    return withTransaction(async (t) => {
      const deletedCount = await UserModel.destroy({
        where: { userId },
        transaction: t,
      });
      if (!deletedCount) throw new NotFoundError('User not found');
      return { success: true };
    });
  }

  static async changePassword(userId: string, payload: ChangePasswordDTO) {
    return withTransaction(async (t) => {
      const user = await UserModel.findByPk(userId, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!user) throw new NotFoundError('User not found');

      const ok = await user.validatePassword(payload.currentPassword);
      if (!ok) throw new AuthError('Current password is incorrect');

      user.password = payload.newPassword;
      await user.save({ transaction: t });
      return { success: true };
    });
  }

  static async setVerified(userId: string, verified: boolean) {
    return withTransaction(async (t) => {
      const user = await UserModel.findByPk(userId, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!user) throw new NotFoundError('User not found');
      user.verified = verified;
      await user.save({ transaction: t });
      return user.toJSON();
    });
  }

  static async getByEmail(email: string) {
    const user = await UserModel.findOne({ where: { email } });
    if (!user) throw new NotFoundError('User not found');
    return user.toJSON();
  }

  static async getByUsername(username: string) {
    const user = await UserModel.findOne({ where: { username } });
    if (!user) throw new NotFoundError('User not found');
    return user.toJSON();
  }

  // ===== PRIVATE SEARCH HELPERS =====

  private static patternFor(value: string, mode: StringMatch) {
    switch (mode) {
      case 'exact':
        return value;
      case 'startsWith':
        return `${value}%`;
      case 'endsWith':
        return `%${value}`;
      case 'like':
      default:
        return `%${value}%`;
    }
  }

  private static stringFieldCondition(
    field: string,
    value: string | string[],
    mode: StringMatch
  ): WhereOptions {
    if (Array.isArray(value)) {
      if (mode === 'exact') return { [field]: { [Op.in]: value } };
      return {
        [Op.or]: value.map((v) => ({
          [field]: { [Op.like]: this.patternFor(v, mode) },
        })),
      };
    }
    if (mode === 'exact') return { [field]: value };
    return { [field]: { [Op.like]: this.patternFor(value, mode) } };
  }

  private static buildUserWhere(
    q?: string,
    filters?: UserFilters
  ): WhereOptions {
    const andParts: WhereOptions[] = [];

    if (q && q.trim()) {
      const like = `%${q.trim()}%`;
      andParts.push({
        [Op.or]: [
          { username: { [Op.like]: like } },
          { email: { [Op.like]: like } },
          { firstName: { [Op.like]: like } },
          { lastName: { [Op.like]: like } },
          { userId: { [Op.like]: like } },
        ],
      });
    }

    if (filters) {
      const match: StringMatch = filters.match ?? 'like';

      if (filters.userId)
        andParts.push(
          this.stringFieldCondition('userId', filters.userId, match)
        );
      if (filters.username)
        andParts.push(
          this.stringFieldCondition('username', filters.username, match)
        );
      if (filters.firstName)
        andParts.push(
          this.stringFieldCondition('firstName', filters.firstName, match)
        );
      if (filters.lastName)
        andParts.push(
          this.stringFieldCondition('lastName', filters.lastName, match)
        );
      if (filters.email)
        andParts.push(this.stringFieldCondition('email', filters.email, match));

      if (typeof filters.verified === 'boolean') {
        andParts.push({ verified: filters.verified });
      }

      if (filters.createdAtFrom || filters.createdAtTo) {
        const cond: any = {};
        if (filters.createdAtFrom)
          cond[Op.gte] = new Date(filters.createdAtFrom);
        if (filters.createdAtTo) cond[Op.lte] = new Date(filters.createdAtTo);
        andParts.push({ createdAt: cond });
      }
      if (filters.updatedAtFrom || filters.updatedAtTo) {
        const cond: any = {};
        if (filters.updatedAtFrom)
          cond[Op.gte] = new Date(filters.updatedAtFrom);
        if (filters.updatedAtTo) cond[Op.lte] = new Date(filters.updatedAtTo);
        andParts.push({ updatedAt: cond });
      }
    }

    return andParts.length ? ({ [Op.and]: andParts } as WhereOptions) : {};
  }
}

export const userService = UserService;
