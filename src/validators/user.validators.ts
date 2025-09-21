// src/validators/user.validators.ts

/**
 * =============================================================================
 * User Validators — express-validator rule sets for /api/users
 * =============================================================================
 * Mount under: /api/users
 *
 * Auth / Access
 * - All routes require `requireAuth` + `requireEmployeeOrAdmin` except:
 *   - POST /employee and PATCH /:id/role → `requireAdmin`
 *
 * Validation
 * - Each validator chain ends with `assertValid`, which forwards a normalized
 *   `{ name: 'ValidationError', status: 400, details: [...] }` to `next()`.
 * - Your global error handler is responsible for formatting the final response.
 *
 * Coverage (route → validator)
 * - POST   /                 → vCreateUser
 * - POST   /employee         → vCreateEmployeeUser
 * - GET    /                 → vListUsers
 * - GET    /filter           → vFilterUsers
 * - GET    /by-email         → vGetByEmail
 * - GET    /by-username      → vGetByUsername
 * - GET    /:id              → vParamUserId
 * - PATCH  /:id              → vUpdateUser
 * - PATCH  /:id/password     → vChangeUserPassword
 * - PATCH  /:id/verified     → vSetUserVerified
 * - PATCH  /:id/role         → vSetUserRole
 * - DELETE /:id              → vDeleteUser
 *
 * Notes
 * - Role values are constrained to: user | employee | administrator
 * - Sort string format: "field:dir" where field ∈ {createdAt, updatedAt,
 *   username, firstName, lastName, email} and dir ∈ {ASC, DESC}.
 * =============================================================================
 */

import type { Request, Response, NextFunction } from 'express';
import { body, param, query, validationResult } from 'express-validator';

const ROLES = ['user', 'employee', 'administrator'] as const;
const SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'username',
  'firstName',
  'lastName',
  'email',
] as const;

type Role = (typeof ROLES)[number];
type SortField = (typeof SORT_FIELDS)[number];

/* -------------------------------------------------------------------------- */
/* Helper: assertValid → throws ValidationError (handled by global handler)    */
/* -------------------------------------------------------------------------- */
export function assertValid(req: Request, _res: Response, next: NextFunction) {
  const result = validationResult(req);
  if (result.isEmpty()) return next();

  const err: any = new Error('Validation failed');
  err.name = 'ValidationError';
  err.status = 400;
  err.details = result.array().map((e) => ({
    type: (e as any).type,
    message: (e as any).msg,
    path: (e as any).path,
    location: (e as any).location,
    value: (e as any).value,
    ...((e as any).nestedErrors
      ? { nestedErrors: (e as any).nestedErrors }
      : {}),
  }));
  return next(err);
}

/* --------------------------------- Commons --------------------------------- */

export const vParamUserId = [
  param('id').isString().trim().notEmpty().withMessage('id is required'),
  assertValid,
];

const roleArrayOrString = (v: unknown) => {
  const isRole = (r: unknown): r is Role =>
    typeof r === 'string' && (ROLES as readonly string[]).includes(r);
  if (v === undefined) return true;
  if (Array.isArray(v)) return v.every(isRole);
  return isRole(v);
};

const sortString = (v: unknown) => {
  if (typeof v !== 'string') return false;
  const [field, dir = 'DESC'] = v.split(':');
  return (
    (SORT_FIELDS as readonly string[]).includes(field as SortField) &&
    ['ASC', 'DESC', 'asc', 'desc'].includes(dir)
  );
};

/* --------------------------------- Create ---------------------------------- */

export const vCreateUser = [
  body('username')
    .exists()
    .withMessage('username is required')
    .bail()
    .isString()
    .trim()
    .notEmpty(),
  body('firstName')
    .exists()
    .withMessage('firstName is required')
    .bail()
    .isString()
    .trim()
    .notEmpty(),
  body('lastName')
    .exists()
    .withMessage('lastName is required')
    .bail()
    .isString()
    .trim()
    .notEmpty(),
  body('email')
    .exists()
    .withMessage('email is required')
    .bail()
    .isEmail()
    .withMessage('email is invalid')
    .normalizeEmail(),
  body('password')
    .exists()
    .withMessage('password is required')
    .bail()
    .isString()
    .isLength({ min: 8 })
    .withMessage('password must be at least 8 characters'),
  assertValid,
];

// Same shape as vCreateUser (Admin-only route)
export const vCreateEmployeeUser = [...vCreateUser];

/* ---------------------------------- List ----------------------------------- */

export const vListUsers = [
  query('q').optional().isString().trim(),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('pageSize').optional().isInt({ min: 1, max: 500 }).toInt(),
  query('authRole')
    .optional()
    .custom(roleArrayOrString)
    .withMessage(
      `authRole must be a role or array of roles: ${ROLES.join(', ')}`
    ),
  query('role')
    .optional()
    .custom(roleArrayOrString)
    .withMessage(`role must be a role or array of roles: ${ROLES.join(', ')}`),
  query('sort')
    .optional()
    .custom(sortString)
    .withMessage(
      `sort must be "field:dir" where field ∈ {${SORT_FIELDS.join(
        ', '
      )}} and dir ∈ {ASC, DESC}`
    ),
  assertValid,
];

// Same validator set for /filter
export const vFilterUsers = [...vListUsers];

/* ------------------------------ Lookups (GET) ------------------------------ */

export const vGetByEmail = [
  query('email')
    .exists()
    .withMessage('email is required')
    .bail()
    .isEmail()
    .withMessage('email is invalid')
    .normalizeEmail(),
  assertValid,
];

export const vGetByUsername = [
  query('username')
    .exists()
    .withMessage('username is required')
    .bail()
    .isString()
    .trim()
    .notEmpty(),
  assertValid,
];

/* --------------------------------- Update ---------------------------------- */

export const vUpdateUser = [
  ...vParamUserId.slice(0, -1), // reuse id rule (without assertValid yet)
  body('username').optional().isString().trim().notEmpty(),
  body('firstName').optional().isString().trim().notEmpty(),
  body('lastName').optional().isString().trim().notEmpty(),
  body('email')
    .optional()
    .isEmail()
    .withMessage('email is invalid')
    .normalizeEmail(),
  assertValid,
];

export const vChangeUserPassword = [
  ...vParamUserId.slice(0, -1),
  body('currentPassword')
    .exists()
    .withMessage('currentPassword is required')
    .bail()
    .isString()
    .isLength({ min: 8 }),
  body('newPassword')
    .exists()
    .withMessage('newPassword is required')
    .bail()
    .isString()
    .isLength({ min: 8 })
    .custom((v, { req }) => v !== req.body.currentPassword)
    .withMessage('newPassword must be different from currentPassword'),
  assertValid,
];

export const vSetUserVerified = [
  ...vParamUserId.slice(0, -1),
  body('verified')
    .exists()
    .withMessage('verified is required')
    .bail()
    .isBoolean()
    .withMessage('verified must be boolean')
    .toBoolean(),
  assertValid,
];

export const vSetUserRole = [
  ...vParamUserId.slice(0, -1),
  body('role')
    .exists()
    .withMessage('role is required')
    .bail()
    .isIn(ROLES as unknown as string[])
    .withMessage(`role must be one of: ${ROLES.join(', ')}`),
  assertValid,
];

/* --------------------------------- Delete ---------------------------------- */

export const vDeleteUser = [...vParamUserId];
