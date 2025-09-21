// src/services/user.service.ts

/**
 * =============================================================================
 * UserService — Business Logic Layer for User Accounts
 * =============================================================================
 * Responsibilities
 *  - Encapsulate all DB operations around UserModel.
 *  - Validate existence before mutations (throw custom errors).
 *  - Handle uniqueness conflicts (DuplicateError).
 *  - Return plain, **serialized** ApiUser objects (no password) and
 *    collections with pagination.
 *
 * Extras
 *  - Role-aware list/filter: exposes only `authorization: { role } | null`.
 *  - Supports `authRole` (single or array) to filter by AuthorizationModel.role.
 *
 * Conventions
 *  - Use `withTransaction` when a method performs a multi-step change.
 *  - Leave HTTP concerns (status codes, response envelopes) to controllers.
 * =============================================================================
 */

import { Op, UniqueConstraintError } from 'sequelize';
import type { FindOptions, WhereOptions, Transaction } from 'sequelize';

import {
  type CreateUserDTO,
  type UpdateUserDTO,
  type ChangePasswordDTO,
  type ListUsersQuery,
  type UserFilters,
  type ApiUser,
} from '../types/user.js';

import type { Role } from '../types/authorization.js';
import { NotFoundError, DuplicateError, AuthError } from '../errors/index.js';
import { UserModel } from '../models/user.model.js';
import { AuthorizationModel } from '../models/authorization.model.js';
import { withTransaction } from '../utils/tx.js';
import {
  serializeUser,
  serializeUsers,
} from '../serializers/user.serializer.js';

// Reused helpers moved to queries module
import { buildUserWhere, normalizeRoles } from '../queries/user.queries.js';

export class UserService {
  /* ============================== CREATE =============================== */

  /**
   * Create a user.
   *
   * @param {CreateUserDTO} payload - User creation input (username, names, email, password).
   * @returns {Promise<ApiUser>} The created user (serialized, no password).
   * @throws {DuplicateError} If username or email already exists.
   */
  static async create(payload: CreateUserDTO): Promise<ApiUser> {
    return withTransaction(async (t: Transaction) => {
      try {
        const user = await UserModel.create(
          {
            username: payload.username,
            firstName: payload.firstName,
            lastName: payload.lastName,
            email: payload.email,
            password: payload.password,
          },
          { transaction: t }
        );
        return serializeUser(user.toJSON());
      } catch (err: any) {
        if (err instanceof UniqueConstraintError) {
          throw new DuplicateError('Username or email already exists');
        }
        throw err;
      }
    });
  }

  /* =============================== READ ================================ */

  /**
   * Get a user by primary key.
   * @param {string} userId - The user id (PK).
   * @returns {Promise<ApiUser>} The found user (serialized).
   * @throws {NotFoundError} If the user does not exist.
   */
  static async getById(userId: string): Promise<ApiUser> {
    const user = await UserModel.findByPk(userId);
    if (!user) throw new NotFoundError('User not found');
    return serializeUser(user.toJSON());
  }

  /**
   * Get a user by unique email.
   * @param {string} email - The unique email address.
   * @returns {Promise<ApiUser>} The found user (serialized).
   * @throws {NotFoundError} If no user is found for the given email.
   */
  static async getByEmail(email: string): Promise<ApiUser> {
    const user = await UserModel.findOne({ where: { email } });
    if (!user) throw new NotFoundError('User not found');
    return serializeUser(user.toJSON());
  }

  /**
   * Get a user by unique username.
   * @param {string} username - The unique username.
   * @returns {Promise<ApiUser>} The found user (serialized).
   * @throws {NotFoundError} If no user is found for the given username.
   */
  static async getByUsername(username: string): Promise<ApiUser> {
    const user = await UserModel.findOne({ where: { username } });
    if (!user) throw new NotFoundError('User not found');
    return serializeUser(user.toJSON());
  }

  /* ================================ LIST =============================== */

  /**
   * List users with optional role filters (via AuthorizationModel).
   *
   * @param {ListUsersQuery & { authRole?: Role | Role[] }} [query]
   *  - `authRole`: filter by AuthorizationModel.role (single or array)
   *  - plus standard paging/sorting and `q`
   * @returns {Promise<{ users: ApiUser[]; total: number; page: number; pageSize: number; pages: number }>}
   */
  static async list(query: ListUsersQuery = {}) {
    const {
      page = 1,
      pageSize = 20,
      q,
      orderBy = 'createdAt',
      orderDir = 'DESC',
    } = query as ListUsersQuery;

    const { authRole } = query as ListUsersQuery & {
      authRole?: Role | Role[];
    };

    // Base WHERE from q
    let where = buildUserWhere(q, undefined);

    // Apply role filter via AuthorizationModel
    const roleList = normalizeRoles(authRole);
    if (roleList?.length) {
      const authRows = await AuthorizationModel.findAll({
        attributes: ['userId'],
        where: { role: { [Op.in]: roleList } },
      });
      const ids = authRows.map((a) => a.userId);
      if (!ids.length) {
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

    // Load auth roles for the returned users
    const userIds = rows.map((u) => u.userId);
    const auths = userIds.length
      ? await AuthorizationModel.findAll({
          where: { userId: { [Op.in]: userIds } },
        })
      : [];
    const authMap = new Map<string, Role>(auths.map((a) => [a.userId, a.role]));

    const users = serializeUsers(
      rows.map((u) => ({
        ...u.toJSON(),
        authorization: authMap.has(u.userId)
          ? { role: authMap.get(u.userId)! }
          : null,
      }))
    );

    return {
      users,
      total: count,
      page,
      pageSize,
      pages: Math.max(1, Math.ceil(count / pageSize)),
    };
  }

  /* ============================== FILTER =============================== */

  /**
   * Advanced filter with optional role & verified flags.
   * Supports all `ListUsersQuery` fields and structured `filters`.
   *
   * @param {ListUsersQuery & { authRole?: Role | Role[]; verified?: boolean }} [query]
   * @returns {Promise<{ users: ApiUser[]; total: number; page: number; pageSize: number; pages: number }>}
   */
  static async filter(query: ListUsersQuery = {}) {
    const {
      page = 1,
      pageSize = 20,
      q,
      filters,
      orderBy = 'createdAt',
      orderDir = 'DESC',
    } = query as ListUsersQuery;

    const { authRole, verified } = query as ListUsersQuery & {
      authRole?: Role | Role[];
      verified?: boolean;
    };

    const mergedFilters: UserFilters | undefined =
      typeof verified === 'boolean'
        ? { ...(filters ?? {}), verified }
        : filters;

    // WHERE from q + structured filters
    let where = buildUserWhere(q, mergedFilters);

    // Apply role filter via AuthorizationModel
    const roleList = normalizeRoles(authRole);
    if (roleList?.length) {
      const authRows = await AuthorizationModel.findAll({
        attributes: ['userId'],
        where: { role: { [Op.in]: roleList } },
      });
      const ids = authRows.map((a) => a.userId);
      if (!ids.length) {
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

    // Attach roles
    const userIds = rows.map((u) => u.userId);
    const auths = userIds.length
      ? await AuthorizationModel.findAll({
          where: { userId: { [Op.in]: userIds } },
        })
      : [];
    const authMap = new Map<string, Role>(auths.map((a) => [a.userId, a.role]));

    const users = serializeUsers(
      rows.map((u) => ({
        ...u.toJSON(),
        authorization: authMap.has(u.userId)
          ? { role: authMap.get(u.userId)! }
          : null,
      }))
    );

    return {
      users,
      total: count,
      page,
      pageSize,
      pages: Math.max(1, Math.ceil(count / pageSize)),
    };
  }

  /* ============================== UPDATE =============================== */

  /**
   * Update profile fields (no password here).
   *
   * @param {string} userId - The user id to update.
   * @param {UpdateUserDTO} updates - Patch of allowed fields (username, firstName, lastName, email).
   * @returns {Promise<ApiUser>} The updated user (serialized).
   * @throws {NotFoundError} If the user does not exist.
   * @throws {DuplicateError} If username or email violates uniqueness.
   */
  static async update(
    userId: string,
    updates: UpdateUserDTO
  ): Promise<ApiUser> {
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
      } catch (err: any) {
        if (err instanceof UniqueConstraintError) {
          throw new DuplicateError('Username or email already exists');
        }
        throw err;
      }

      return serializeUser(user.toJSON());
    });
  }

  /* ============================ PASSWORD =============================== */

  /**
   * Change a user's password after validating the current password.
   *
   * @param {string} userId - The user id.
   * @param {ChangePasswordDTO} payload - Current and new password.
   * @returns {Promise<{ success: true }>} Success flag.
   * @throws {NotFoundError} If the user does not exist.
   * @throws {AuthError} If the current password is incorrect.
   */
  static async changePassword(
    userId: string,
    payload: ChangePasswordDTO
  ): Promise<{ success: true }> {
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

  /* ============================= VERIFIED ============================== */

  /**
   * Toggle the `verified` flag of a user.
   * @param {string} userId - The user id.
   * @param {boolean} verified - The target state.
   * @returns {Promise<ApiUser>} The updated user (serialized).
   * @throws {NotFoundError} If the user does not exist.
   */
  static async setVerified(
    userId: string,
    verified: boolean
  ): Promise<ApiUser> {
    return withTransaction(async (t) => {
      const user = await UserModel.findByPk(userId, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!user) throw new NotFoundError('User not found');

      user.verified = verified;
      await user.save({ transaction: t });
      return serializeUser(user.toJSON());
    });
  }

  /* ============================== DELETE =============================== */

  /**
   * Hard-delete a user.
   * @param {string} userId - The user id to delete.
   * @returns {Promise<{ success: true }>} Success flag.
   * @throws {NotFoundError} If no row was deleted.
   */
  static async delete(userId: string): Promise<{ success: true }> {
    return withTransaction(async (t) => {
      const deletedCount = await UserModel.destroy({
        where: { userId },
        transaction: t,
      });
      if (!deletedCount) throw new NotFoundError('User not found');
      return { success: true };
    });
  }

  /**
   * Assign a role to a user via AuthorizationModel.
   * Returns the user with `authorization: { role }`.
   *
   * @param {string} userId
   * @param {'user'|'employee'|'administrator'} role
   * @returns {Promise<ApiUser>}
   * @throws {NotFoundError} if user not found
   */
  static async setRole(
    userId: string,
    role: 'user' | 'employee' | 'administrator'
  ): Promise<ApiUser> {
    return withTransaction(async (t) => {
      const user = await UserModel.findByPk(userId, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!user) throw new NotFoundError('User not found');

      const existing = await AuthorizationModel.findOne({
        where: { userId },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (existing) {
        existing.role = role as any;
        await existing.save({ transaction: t });
      } else {
        await AuthorizationModel.create(
          { userId, role: role as any },
          { transaction: t }
        );
      }

      // Serialize + attach authorization role in the response
      const api = serializeUser(user.toJSON());
      return { ...api, authorization: { role } } as ApiUser;
    });
  }
}

export const userService = UserService;
