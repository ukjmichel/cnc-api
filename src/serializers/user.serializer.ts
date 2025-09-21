// src/serializers/user.serializer.ts

/**
 * =============================================================================
 * User serializer — normalize/secure user objects for API responses
 * =============================================================================
 * - `serializeApiUser` / `serializeApiUsers`: strict, API-safe (never exposes password fields,
 *   strips unknowns, moves role to authorization.role).
 * - `serializeUserForResponse` / `serializeUsers`: lightweight helpers that only normalize
 *   `authorization.role` without stripping extra fields. Useful for generic objects.
 * - `serializeUser`: alias of `serializeApiUser` (back-compat for existing imports).
 * =============================================================================
 */

import type { ApiUser } from '../types/user.js';

type AnyUser = Record<string, any> | null | undefined;

/** Internal: normalize role into authorization.role */
function normalizeAuthorization(u: AnyUser): {
  authorization: { role: string } | null;
} {
  if (!u) return { authorization: null };
  const role =
    (u as any).authorization?.role ??
    (typeof (u as any).role === 'string' ? (u as any).role : null);
  return role ? { authorization: { role } } : { authorization: null };
}

/**
 * Strict API serializer for a single user.
 * - Removes top-level `role`, password/hash/salt, and unknown fields.
 * - Moves role to `authorization.role`.
 */
export function serializeApiUser(u: AnyUser): ApiUser {
  if (!u) return u as unknown as ApiUser;

  const {
    // allowed fields
    userId,
    id, // fallback if your model uses `id`
    username,
    firstName,
    lastName,
    email,
    verified,
    createdAt,
    updatedAt,
    // stripped fields
    password,
    passwordHash,
    salt,
    role: _omitRole,
    authorization: _omitAuthorization,
    ..._rest // ignore unknowns to avoid leaking internals
  } = u as Record<string, any>;

  const auth = normalizeAuthorization(u);

  const apiUser: ApiUser = {
    userId: userId ?? id,
    username,
    firstName,
    lastName,
    email,
    verified: Boolean(verified),
    createdAt,
    updatedAt,
    ...auth,
  };

  return apiUser;
}

/** Strict API serializer for an array of users. */
export function serializeApiUsers(users: AnyUser[]): ApiUser[] {
  if (!Array.isArray(users)) return [];
  return users.map(serializeApiUser);
}

/**
 * Normalize a user object for API responses (lightweight).
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
export function serializeUserForResponse<T extends Record<string, any>>(u: T) {
  if (!u) return u as any;
  const role = (u as any).role ?? (u as any).authorization?.role ?? null;
  const { role: _omitRole, authorization: _omitAuth, ...rest } = u as any;
  return { ...rest, authorization: role ? { role } : null } as T & {
    authorization: { role: string } | null;
  };
}

/**
 * Normalize an array of users for API responses (lightweight).
 *
 * @template T extends Record<string, any>
 * @param {T[]} users - Array of user rows/objects.
 * @returns {(T & { authorization: { role: string } | null })[]} Normalized users.
 */
export function serializeUsers<T extends Record<string, any>>(users: T[]) {
  return users.map(serializeUserForResponse);
}

/* -------------------------------------------------------------------------- */
/* Back-compat named export to match existing imports                          */
/* -------------------------------------------------------------------------- */
export { serializeApiUser as serializeUser };
