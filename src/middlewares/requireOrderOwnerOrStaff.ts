// src/middlewares/requireOrderOwnerOrStaff.ts

/**
 * =============================================================================
 * requireOrderOwnerOrStaff — Ownership-or-Staff access guard
 * =============================================================================
 * Purpose
 *  - Permit access to routes that operate on a specific order when the caller:
 *      • is the order owner (order.userId === req.user.userId), OR
 *      • has a staff role: "employee" or "administrator".
 *
 * Assumptions
 *  - `requireAuth` has already populated `req.user`.
 *  - The route includes a path param named `orderId` (e.g. /api/orders/:orderId/...).
 *
 * Responses
 *  - 401 Unauthorized       → no authenticated user present
 *  - 400 Bad Request        → missing orderId param
 *  - 404 Not Found          → order doesn't exist
 *  - 403 Forbidden          → user is neither owner nor staff
 *
 * Notes
 *  - Use this BEFORE your route handler (after requireAuth).
 *  - If you need a different param name, adapt the extractor for `orderId`.
 * =============================================================================
 */

import type { Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from './requireAuth.js';
import {
  AuthorizationModel,
  type Role,
} from '../models/authorization.model.js';
import { OrderModel } from '../models/order.model.js';

const STAFF_ROLES: ReadonlySet<Role> = new Set<Role>([
  'employee',
  'administrator',
]);

/** Lookup a user's role; returns null if no authorization row. */
async function fetchUserRole(userId: string): Promise<Role | null> {
  const row = (await AuthorizationModel.findOne({
    where: { userId },
    attributes: ['role'],
    raw: true,
  })) as { role: Role } | null;
  return row?.role ?? null;
}

/**
 * Middleware: allow if user owns the order OR is staff (employee/admin).
 */
export async function requireOrderOwnerOrStaff(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    // must be authenticated first
    const authUserId = req.user?.userId;
    if (!authUserId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const orderId = String(req.params?.orderId ?? '').trim();
    if (!orderId) {
      return res
        .status(400)
        .json({ message: 'Bad Request: orderId param required' });
    }

    // fast-path: staff can proceed
    const role = await fetchUserRole(authUserId);
    if (role && STAFF_ROLES.has(role)) {
      return next();
    }

    // otherwise, must be the owner
    const order = await OrderModel.findByPk(orderId, {
      attributes: ['orderId', 'userId'],
    });
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (order.userId !== authUserId) {
      return res.status(403).json({ message: 'Forbidden: not owner or staff' });
    }

    // owner allowed
    return next();
  } catch (err) {
    // fall back to generic 500 if something unexpected happens
    return res.status(500).json({ message: 'Internal Server Error' });
  }
}
