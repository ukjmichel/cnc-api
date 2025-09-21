/**
 * =============================================================================
 * User Serializer
 * =============================================================================
 * Purpose
 *  - Convert raw Sequelize rows (or plain objects) into API-safe shapes.
 *  - Strip sensitive fields (e.g., password).
 *  - Normalize role exposure into `authorization: { role } | null`.
 *
 * Notes
 *  - Accepts either a plain object or a Sequelize instance's `.toJSON()` output.
 *  - If a caller passes `role` on the object (e.g., via a JOIN), it is moved
 *    under `authorization.role`.
 *  - If the object already contains `authorization.role`, it is respected.
 * =============================================================================
 */

import type { ApiUser } from '../types/user.js';

type AnyUser = Record<string, any>;

/** Build `{ authorization: { role } | null }` from loose inputs. */
function extractAuthorization(u: AnyUser): ApiUser['authorization'] {
  const role: string | undefined =
    (u.authorization && u.authorization.role) || u.role;
  return role ? { role } : null;
}

/**
 * Convert a user row/object into an ApiUser.
 * - Removes `password` and any top-level `role`.
 * - Adds/normalizes `authorization`.
 */
export function serializeUser(input: AnyUser): ApiUser {
  if (!input) {
    
    return input;
  }

  const {
    password: _omitPassword,
    role: _omitRole,
    authorization: _maybeAuth,
    ...rest
  } = input;

  const authorization = extractAuthorization(input);

  // The remaining fields should match ApiUser (minus authorization)
  const base = rest as Omit<ApiUser, 'authorization'>;

  return {
    ...base,
    authorization,
  };
}

/** Serialize an array of users. */
export function serializeUsers(list: AnyUser[]): ApiUser[] {
  return list.map(serializeUser);
}
