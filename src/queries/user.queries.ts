// src/queries/user.queries.ts

/**
 * =============================================================================
 * User queries — builders & helpers for list/filter endpoints
 * =============================================================================
 * Purpose
 *  - Transform URL query strings into typed objects used by the service layer.
 *  - Support free-text search, structured filters, sorting, pagination.
 *  - Normalize role filters from query string into `authRole` (AuthorizationModel).
 *  - Expose reusable helpers for building Sequelize WHERE clauses.
 *
 * Important
 *  - `role` is **NOT** on UserModel. Roles live in AuthorizationModel.
 *    We therefore accept `?role=` or `?authRole=` in the URL, but we always
 *    emit `authRole` in the returned query object for DB-side filtering.
 *
 * Output
 *  - `buildUserListQuery(qs)` → ListUsersQuery & { authRole?: Role | Role[] }
 *  - `buildUserFilterQuery(qs)` → ListUsersQuery & { authRole?: Role | Role[] }
 *  - Reusable helpers: `normalizeRoles`, `patternFor`, `stringFieldCondition`, `buildUserWhere`
 * =============================================================================
 */

import type {
  ListUsersQuery,
  UserFilters,
  StringMatch,
} from '../types/user.js';
import type { Role } from '../types/authorization.js';
import { Op, type WhereOptions } from 'sequelize';
import {
  toInt,
  qsArray,
  qsBool,
  normalizeSort,
  parseStringMatch,
} from '../utils/query.js';

/**
 * Allowed ordering fields for list/filter endpoints.
 * ⚠️ `role` is intentionally excluded (not present on UserModel).
 */
export const USER_ORDER_FIELDS = [
  'createdAt',
  'updatedAt',
  'username',
  'firstName',
  'lastName',
  'email',
] as const;

type UserOrderByField = (typeof USER_ORDER_FIELDS)[number];

/** Whitelist of valid roles (AuthorizationModel.role). */
const ALLOWED_ROLES: Role[] = ['user', 'employee', 'administrator'];

/**
 * Parse a single role value from an unknown query param.
 *
 * @param {unknown} v - The raw query value (e.g., `req.query.role`).
 * @returns {Role | undefined} A valid Role or `undefined` if invalid/missing.
 */
export function qsRole(v: unknown): Role | undefined {
  if (typeof v !== 'string') return undefined;
  const r = v.toLowerCase().trim() as Role;
  return (ALLOWED_ROLES as readonly string[]).includes(r) ? r : undefined;
}

/**
 * Parse one or many roles from a query param.
 * Supports `role=..&role=..`, `role[]=..`, and `authRole` equivalents.
 *
 * @param {unknown} v - The raw query value (string | string[] | undefined).
 * @returns {Role[] | undefined} Array of roles, or `undefined` if none valid.
 */
export function qsRoles(v: unknown): Role[] | undefined {
  // Default to [] when qsArray returns undefined
  const arr = (qsArray(v) ?? []).map((s) => String(s).toLowerCase().trim());
  const roles = arr
    .map((s) =>
      (ALLOWED_ROLES as readonly string[]).includes(s) ? (s as Role) : undefined
    )
    .filter(Boolean) as Role[];
  return roles.length ? roles : undefined;
}

/**
 * Normalize a role or array of roles into an array (or `undefined` if falsy).
 * Useful on the service layer to accept both single and multi-role inputs.
 *
 * @param {Role | Role[] | undefined} input - A single role, a list of roles, or undefined.
 * @returns {Role[] | undefined} An array of roles, or `undefined` if no input.
 */
export function normalizeRoles(input?: Role | Role[]): Role[] | undefined {
  if (!input) return undefined;
  return Array.isArray(input) ? input : [input];
}

/**
 * Build a SQL LIKE/ILIKE pattern from a value and match mode.
 *
 * @param {string} value - The input string to patternize.
 * @param {StringMatch} mode - 'exact' | 'startsWith' | 'endsWith' | 'like'.
 * @returns {string} A pattern suitable for use with Sequelize LIKE.
 */
export function patternFor(value: string, mode: StringMatch): string {
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
 *
 * @param {string} field - Column/attribute name.
 * @param {string | string[]} value - One or many values to match.
 * @param {StringMatch} mode - Matching mode.
 * @returns {WhereOptions} A Sequelize where fragment.
 */
export function stringFieldCondition(
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
 *
 * @param {string | undefined} q - Free-text query applied across common string fields.
 * @param {UserFilters | undefined} filters - Structured filters (ids, names, email, dates, verified).
 * @returns {WhereOptions} Combined Sequelize where clause (possibly empty object).
 */
export function buildUserWhere(
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

type Qs = Record<string, unknown>;

/**
 * Build ListUsersQuery for `GET /api/users` (free-text only).
 *
 * Accepts `?role=` and/or `?authRole=` in the URL, but **returns only** `authRole`
 * because roles are stored on AuthorizationModel.
 *
 * @param {Qs} qs - Raw querystring map (e.g., `req.query`).
 * @returns {ListUsersQuery & { authRole?: Role | Role[] }}
 *  - `page`, `pageSize`, `q`, `orderBy`, `orderDir`, and optional `authRole`.
 */
export function buildUserListQuery(
  qs: Qs
): ListUsersQuery & { authRole?: Role | Role[] } {
  const { orderBy, orderDir } = normalizeSort<UserOrderByField>(
    qs.orderBy,
    qs.orderDir,
    USER_ORDER_FIELDS,
    'createdAt'
  );

  // Accept both ?role=... and ?authRole=... for convenience; prefer `role` if present
  const rolesFromRole = qsRoles(qs.role);
  const rolesFromAuth = qsRoles(qs.authRole);
  const merged =
    (rolesFromRole?.length ? rolesFromRole : undefined) ??
    (rolesFromAuth?.length ? rolesFromAuth : undefined);

  return {
    page: toInt(qs.page, 1),
    pageSize: toInt(qs.pageSize, 20),
    q: typeof qs.q === 'string' ? qs.q : undefined,
    orderBy,
    orderDir,
    authRole: merged?.length === 1 ? merged[0] : merged,
  };
}

/**
 * Build ListUsersQuery for `GET /api/users/filter` (advanced).
 *
 * Accepts `?role=` and/or `?authRole=` in the URL, but **returns only** `authRole`
 * because roles are stored on AuthorizationModel. Also parses structured filters
 * and free-text matching options.
 *
 * @param {Qs} qs - Raw querystring map (e.g., `req.query`).
 * @returns {ListUsersQuery & { authRole?: Role | Role[] }}
 *  - `page`, `pageSize`, `q`, `filters`, `orderBy`, `orderDir`, and optional `authRole`.
 */
export function buildUserFilterQuery(
  qs: Qs
): ListUsersQuery & { authRole?: Role | Role[] } {
  const { orderBy, orderDir } = normalizeSort<UserOrderByField>(
    qs.orderBy,
    qs.orderDir,
    USER_ORDER_FIELDS,
    'createdAt'
  );

  const rolesFromRole = qsRoles(qs.role);
  const rolesFromAuth = qsRoles(qs.authRole);
  const merged =
    (rolesFromRole?.length ? rolesFromRole : undefined) ??
    (rolesFromAuth?.length ? rolesFromAuth : undefined);

  let filters: UserFilters | undefined;

  // Allow ?filters=<json>
  if (typeof qs.filters === 'string' && qs.filters.trim()) {
    try {
      filters = JSON.parse(qs.filters) as UserFilters;
    } catch {
      // ignore bad JSON; fallback to individual params
    }
  }

  if (!filters) {
    filters = {
      userId: qsArray(qs.userId),
      username: qsArray(qs.username),
      firstName: qsArray(qs.firstName),
      lastName: qsArray(qs.lastName),
      email: qsArray(qs.email),

      verified: qsBool(qs.verified),

      createdAtFrom:
        typeof qs.createdAtFrom === 'string' ? qs.createdAtFrom : undefined,
      createdAtTo:
        typeof qs.createdAtTo === 'string' ? qs.createdAtTo : undefined,
      updatedAtFrom:
        typeof qs.updatedAtFrom === 'string' ? qs.updatedAtFrom : undefined,
      updatedAtTo:
        typeof qs.updatedAtTo === 'string' ? qs.updatedAtTo : undefined,

      // canonical string-match parser (accepts startswith/endswith too)
      match: parseStringMatch(qs.match) as StringMatch,
    };
  } else {
    // ensure canonical value if not set
    filters.match = (filters.match ??
      parseStringMatch(qs.match)) as StringMatch;
  }

  return {
    page: toInt(qs.page, 1),
    pageSize: toInt(qs.pageSize, 20),
    q: typeof qs.q === 'string' ? qs.q : undefined,
    filters,
    orderBy,
    orderDir,
    authRole: merged?.length === 1 ? merged[0] : merged,
  };
}
