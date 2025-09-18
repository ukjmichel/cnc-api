// src/queries/user.queries.ts
import type {
  ListUsersQuery,
  UserFilters,
  StringMatch,
} from '../types/user.js';
import {
  toInt,
  qsArray,
  qsBool,
  normalizeSort,
  parseStringMatch,
} from '../utils/query.js';

/** Allowed ordering fields for list/filter endpoints (as const for literal union). */
export const USER_ORDER_FIELDS = [
  'createdAt',
  'updatedAt',
  'username',
  'firstName',
  'lastName',
  'email',
  'role',
] as const;

type UserOrderByField = (typeof USER_ORDER_FIELDS)[number];

/** Role union and helper (for controller-side role filter) */
export type Role = 'user' | 'employee' | 'administrator';
export const ROLES: Role[] = ['user', 'employee', 'administrator'];

export function qsRole(v: unknown): Role | undefined {
  if (typeof v !== 'string') return undefined;
  const r = v.toLowerCase() as Role;
  return ROLES.includes(r) ? r : undefined;
}

type Qs = Record<string, unknown>;

/** Build ListUsersQuery for /api/users (free-text only). */
export function buildUserListQuery(qs: Qs): ListUsersQuery {
  const { orderBy, orderDir } = normalizeSort<UserOrderByField>(
    qs.orderBy,
    qs.orderDir,
    USER_ORDER_FIELDS,
    'createdAt'
  );

  return {
    page: toInt(qs.page, 1),
    pageSize: toInt(qs.pageSize, 20),
    q: typeof qs.q === 'string' ? qs.q : undefined,
    orderBy,
    orderDir,
  };
}

/** Build ListUsersQuery for /api/users/filter (advanced). */
export function buildUserFilterQuery(qs: Qs): ListUsersQuery {
  const { orderBy, orderDir } = normalizeSort<UserOrderByField>(
    qs.orderBy,
    qs.orderDir,
    USER_ORDER_FIELDS,
    'createdAt'
  );

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
  };
}
