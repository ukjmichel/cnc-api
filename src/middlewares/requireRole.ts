// src/middlewares/requireRole.ts

/**
 * =============================================================================
 * requireRole — Role-based access control (RBAC) middleware
 * =============================================================================
 * Purpose
 *  - Guard routes by required role(s) using the AuthorizationModel.
 *
 * Assumptions
 *  - `requireAuth` (or equivalent) has already populated `req.user`.
 *  - Authorization data is stored in `authorization` table keyed by userId.
 *
 * Exports
 *  - requireEmployee         → only "employee"
 *  - requireAdmin            → only "administrator"
 *  - requireEmployeeOrAdmin  → "employee" OR "administrator"
 *
 * Notes
 *  - Returns:
 *      401 if no authenticated user (missing req.user)
 *      403 if no authorization row or role not allowed
 *  - If you prefer a hierarchical policy (admin implies employee), change
 *    `requireEmployee` to allow both roles or use `requireEmployeeOrAdmin`.
 * =============================================================================
 */

import type { Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from './requireAuth.js';
import {
  AuthorizationModel,
  type Role,
} from '../models/authorization.model.js';

/** Fetch the user's role from DB; returns null if no row. */
async function fetchUserRole(userId: string): Promise<Role | null> {
  const row = (await AuthorizationModel.findOne({
    where: { userId },
    attributes: ['role'],
    raw: true,
  })) as { role: Role } | null;

  return row?.role ?? null;
}

/**
 * Factory: create a middleware that allows ONLY the provided roles.
 * @param allowed Roles that are permitted for the route.
 */
function requireRole(allowed: Role[]) {
  const allowedSet = new Set<Role>(allowed);

  return async function (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) {
    // Ensure authentication happened
    if (!req.user?.userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    // Lookup role
    const role = await fetchUserRole(req.user.userId);
    if (!role) {
      // Treat missing authorization as forbidden (no policy assigned)
      return res
        .status(403)
        .json({ message: 'Forbidden: no authorization assigned' });
    }

    if (!allowedSet.has(role)) {
      return res.status(403).json({ message: 'Forbidden: insufficient role' });
    }

    // Authorized
    return next();
  };
}

/** Allow only "employee". */
export const requireEmployee = requireRole(['employee']);

/** Allow only "administrator". */
export const requireAdmin = requireRole(['administrator']);

/** Allow "employee" OR "administrator". */
export const requireEmployeeOrAdmin = requireRole([
  'employee',
  'administrator',
]);
