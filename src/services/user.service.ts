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
 *  - Accept optional `authRole` (single or array) to include only users
 *    who have one of those roles in AuthorizationModel.
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
  type StringMatch,
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

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Normalize a role or array of roles into an array (or `undefined` if falsy).
 * @param {Role | Role[] | undefined} input - A single role, a list of roles, or undefined.
 * @returns {Role[] | undefined} An array of roles, or `undefined` if no input.
 */
function normalizeRoles(input?: Role | Role[]): Role[] | undefined {
  if (!input) return undefined;
  return Array.isArray(input) ? input : [input];
}

/**
 * Build a SQL LIKE/ILIKE pattern from a value and match mode.
 * @param {string} value - The input string to patternize.
 * @param {StringMatch} mode - Matching mode: 'exact' | 'startsWith' | 'endsWith' | 'like'.
 * @returns {string} A pattern suitable for use with Sequelize LIKE.
 */
function patternFor(value: string, mode: StringMatch) {
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

/**
 * Create a WHERE condition for a single string field using a value or array of values.
 * @param {string} field - Column/attribute name.
 * @param {string | string[]} value - One or many values to match.
 * @param {StringMatch} mode - Matching mode.
 * @returns {WhereOptions} A Sequelize where fragment.
 */
function stringFieldCondition(
  field: string,
  value: string | string[],
  mode: StringMatch
): WhereOptions {
  if (Array.isArray(value)) {
    if (mode === 'exact') return { [field]: { [Op.in]: value } };
    return {
      [Op.or]: value.map((v) => ({
        [field]: { [Op.like]: patternFor(v, mode) },
      })),
    };
  }
  if (mode === 'exact') return { [field]: value };
  return { [field]: { [Op.like]: patternFor(value, mode) } };
}

/**
 * Build a composite WHERE clause for users using free-text `q` and structured filters.
 * @param {string | undefined} q - Free-text query applied across common string fields.
 * @param {UserFilters | undefined} filters - Structured filters (ids, names, email, dates, verified).
 * @returns {WhereOptions} Combined Sequelize where clause (possibly empty object).
 */
function buildUserWhere(q?: string, filters?: UserFilters): WhereOptions {
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
      andParts.push(stringFieldCondition('userId', filters.userId, match));
    if (filters.username)
      andParts.push(stringFieldCondition('username', filters.username, match));
    if (filters.firstName)
      andParts.push(
        stringFieldCondition('firstName', filters.firstName, match)
      );
    if (filters.lastName)
      andParts.push(stringFieldCondition('lastName', filters.lastName, match));
    if (filters.email)
      andParts.push(stringFieldCondition('email', filters.email, match));

    if (typeof filters.verified === 'boolean') {
      andParts.push({ verified: filters.verified });
    }

    if (filters.createdAtFrom || filters.createdAtTo) {
      const cond: any = {};
      if (filters.createdAtFrom) cond[Op.gte] = new Date(filters.createdAtFrom);
      if (filters.createdAtTo) cond[Op.lte] = new Date(filters.createdAtTo);
      andParts.push({ createdAt: cond });
    }
    if (filters.updatedAtFrom || filters.updatedAtTo) {
      const cond: any = {};
      if (filters.updatedAtFrom) cond[Op.gte] = new Date(filters.updatedAtFrom);
      if (filters.updatedAtTo) cond[Op.lte] = new Date(filters.updatedAtTo);
      andParts.push({ updatedAt: cond });
    }
  }

  return andParts.length ? ({ [Op.and]: andParts } as WhereOptions) : {};
}

/* -------------------------------------------------------------------------- */
/* Service                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Business logic layer for user accounts.
 *
 * @remarks
 * - Encapsulates all DB operations around {@link UserModel}.
 * - Validates existence before mutations, throwing {@link NotFoundError}.
 * - Handles uniqueness conflicts by mapping {@link UniqueConstraintError} to {@link DuplicateError}.
 * - Returns serialized {@link ApiUser} objects (without password) and paginated collections.
 *
 * @extras
 * - Role-aware list/filter via {@link AuthorizationModel}, exposing only `authorization: { role } | null`.
 * - Accepts optional `authRole` (single or array) to include only users with those roles.
 *
 * @conventions
 * - Use {@link withTransaction} when a method performs a multi-step change.
 * - Leave HTTP concerns (status codes, response envelopes) to controllers.
 */
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

  /**
   * List users with optional role filter (via AuthorizationModel).
   *
   * @param {ListUsersQuery} [query] - Pagination, sorting and free-text query.
   * @param {number} [query.page=1] - 1-based page index.
   * @param {number} [query.pageSize=20] - Page size limit.
   * @param {string} [query.q] - Free-text search across several fields.
   * @param {Role|Role[]} [query.authRole] - Filter to users that have one of the roles.
   * @param {keyof ApiUser | 'createdAt' | 'updatedAt'} [query.orderBy='createdAt'] - Order column.
   * @param {'ASC'|'DESC'} [query.orderDir='DESC'] - Order direction.
   * @returns {Promise<{ users: ApiUser[]; total: number; page: number; pageSize: number; pages: number }>}
   * Serialized users with pagination meta. `authorization` includes `{ role }` or `null`.
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

    // Base WHERE from q
    let where = buildUserWhere(q, undefined);

    // Role filter through authorization table
    const roles = normalizeRoles(authRole);
    if (roles?.length) {
      const authRows = await AuthorizationModel.findAll({
        attributes: ['userId'],
        where: { role: { [Op.in]: roles } },
      });
      const ids = authRows.map((a) => a.userId);
      if (ids.length === 0) {
        return { users: [] as ApiUser[], total: 0, page, pageSize, pages: 1 };
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

  /**
   * Advanced filter with optional role & verified flags.
   * Supports all `ListUsersQuery` fields and structured `filters`.
   *
   * @param {ListUsersQuery} [query] - Query object with pagination, sort, `q`, `filters`, `authRole`, `verified`.
   * @returns {Promise<{ users: ApiUser[]; total: number; page: number; pageSize: number; pages: number }>}
   * Serialized users with pagination meta. `authorization` includes `{ role }` or `null`.
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

    // WHERE from q + structured filters
    let where = buildUserWhere(q, mergedFilters);

    // Role filter via AuthorizationModel
    const roles = normalizeRoles(authRole);
    if (roles?.length) {
      const authRows = await AuthorizationModel.findAll({
        attributes: ['userId'],
        where: { role: { [Op.in]: roles } },
      });
      const ids = authRows.map((a) => a.userId);
      if (ids.length === 0) {
        return { users: [] as ApiUser[], total: 0, page, pageSize, pages: 1 };
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
}

export const userService = UserService;
