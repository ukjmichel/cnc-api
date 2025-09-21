// src/validators/order.validator.ts
import { body, param, query } from 'express-validator';

/**
 * =============================================================================
 * Order Validators — express-validator chains for Orders
 * =============================================================================
 * What this file provides
 *  - Reusable validation chains for each Orders route (create, list/filter,
 *    self-list, by-id lookups, and field updates).
 *
 * How to use
 *  - Attach one (or more) of these arrays before your controller handler.
 *  - Then either:
 *      • call `validationResult(req)` inside the controller, OR
 *      • use your own middleware that collects and formats validation errors.
 *
 * Notes
 *  - Built for express-validator v7+ (error objects use `path` rather than `param`).
 *  - Keep the enums below in sync with your Order model/service.
 *  - Totals are validated as **decimal strings** to avoid floating-point issues.
 * =============================================================================
 */

/** Allowed status values (keep in sync with model/service). */
const ORDER_STATUSES = [
  'draft',
  'pending',
  'paid',
  'cancelled',
  'fulfilled',
  'refunded',
] as const;

/** Whitelisted sortable fields for list/filter endpoints. */
const ORDER_ORDER_BY = [
  'createdAt',
  'updatedAt',
  'grandTotal',
  'status',
] as const;

/** Sort direction whitelist. */
const ORDER_DIR = ['ASC', 'DESC'] as const;

/**
 * Basic decimal-string guard (no sign, any precision).
 * Examples: "0", "10", "12.34"  ✅
 *           12.34 (number), "", "12.", ".34"  ❌
 */
const isDecimalString = (v: unknown) =>
  typeof v === 'string' && /^\d+(\.\d+)?$/.test(v.trim());

/* ============================================================================
 * Create — POST /api/orders
 * ==========================================================================*/
/**
 * Validate `create order` payload.
 * Optional fields are allowed but must match the expected types when present.
 * - userId?: string
 * - status?: one of ORDER_STATUSES
 * - subtotal?, taxTotal?, grandTotal?: decimal strings
 * - currency?: 3-letter uppercase code (e.g., USD)
 * - contactName?, contactPhone?, notes?: string
 * - pickupSlotId?: string | null
 */
export const vCreateOrder = [
  body('userId')
    .optional({ values: 'null' })
    .isString()
    .withMessage('userId must be a string')
    .bail()
    .notEmpty()
    .withMessage('userId cannot be empty'),

  body('status')
    .optional({ values: 'falsy' })
    .isIn(ORDER_STATUSES as unknown as string[])
    .withMessage(`status must be one of: ${ORDER_STATUSES.join(', ')}`),

  body('subtotal')
    .optional({ values: 'falsy' })
    .custom(isDecimalString)
    .withMessage('subtotal must be a decimal string'),

  body('taxTotal')
    .optional({ values: 'falsy' })
    .custom(isDecimalString)
    .withMessage('taxTotal must be a decimal string'),

  body('grandTotal')
    .optional({ values: 'falsy' })
    .custom(isDecimalString)
    .withMessage('grandTotal must be a decimal string'),

  body('currency')
    .optional({ values: 'falsy' })
    .isString()
    .withMessage('currency must be a string')
    .bail()
    .matches(/^[A-Z]{3}$/)
    .withMessage('currency must be a 3-letter uppercase code (e.g., USD)'),

  body('contactName')
    .optional({ values: 'falsy' })
    .isString()
    .withMessage('contactName must be a string'),

  body('contactPhone')
    .optional({ values: 'falsy' })
    .isString()
    .withMessage('contactPhone must be a string'),

  body('notes')
    .optional({ values: 'falsy' })
    .isString()
    .withMessage('notes must be a string'),

  body('pickupSlotId')
    .optional({ values: 'null' })
    .custom((v) => v === null || (typeof v === 'string' && v.trim().length > 0))
    .withMessage('pickupSlotId must be a non-empty string or null'),
];

/* ============================================================================
 * List / Filter (admin) — GET /api/orders & /api/orders/filter
 * NOTE: Keep types as strings; controllers parse them.
 * ==========================================================================*/
/**
 * Validate admin list/filter query params.
 * - userId?: string
 * - status?: CSV string
 * - pickupSlotId?: string ("null" allowed to represent unassigned)
 * - dateFrom?, dateTo?: ISO date
 * - page?, pageSize?: ints
 * - orderBy?, orderDir?: whitelisted values
 */
export const vListOrders = [
  query('userId')
    .optional({ values: 'falsy' })
    .isString()
    .withMessage('userId must be a string'),

  query('status')
    .optional({ values: 'falsy' })
    .isString()
    .withMessage('status must be a CSV string of valid statuses'),

  query('pickupSlotId')
    .optional({ values: 'falsy' })
    .isString()
    .withMessage(
      'pickupSlotId must be a string (use "null" to filter unassigned)'
    ),

  query('dateFrom')
    .optional({ values: 'falsy' })
    .isISO8601()
    .withMessage('dateFrom must be an ISO-8601 date'),

  query('dateTo')
    .optional({ values: 'falsy' })
    .isISO8601()
    .withMessage('dateTo must be an ISO-8601 date'),

  query('page')
    .optional({ values: 'falsy' })
    .isInt({ min: 1 })
    .withMessage('page must be an integer >= 1'),

  query('pageSize')
    .optional({ values: 'falsy' })
    .isInt({ min: 1 })
    .withMessage('pageSize must be an integer >= 1'),

  query('orderBy')
    .optional({ values: 'falsy' })
    .isIn(ORDER_ORDER_BY as unknown as string[])
    .withMessage(`orderBy must be one of: ${ORDER_ORDER_BY.join(', ')}`),

  query('orderDir')
    .optional({ values: 'falsy' })
    .isIn(ORDER_DIR as unknown as string[])
    .withMessage('orderDir must be ASC or DESC'),
];

/** Alias for /filter (same query params). */
export const vFilterOrders = vListOrders;

/* ============================================================================
 * Self list — GET /api/orders/self
 * ==========================================================================*/
/**
 * Validate self list query (same as admin list, minus userId).
 * - status?: CSV string
 * - pickupSlotId?: string ("null" allowed)
 * - dateFrom?, dateTo?: ISO date
 * - page?, pageSize?: ints
 * - orderBy?, orderDir?: whitelisted values
 */
export const vListSelfOrders = [
  query('status')
    .optional({ values: 'falsy' })
    .isString()
    .withMessage('status must be a CSV string of valid statuses'),

  query('pickupSlotId')
    .optional({ values: 'falsy' })
    .isString()
    .withMessage(
      'pickupSlotId must be a string (use "null" to filter unassigned)'
    ),

  query('dateFrom')
    .optional({ values: 'falsy' })
    .isISO8601()
    .withMessage('dateFrom must be an ISO-8601 date'),

  query('dateTo')
    .optional({ values: 'falsy' })
    .isISO8601()
    .withMessage('dateTo must be an ISO-8601 date'),

  query('page')
    .optional({ values: 'falsy' })
    .isInt({ min: 1 })
    .withMessage('page must be an integer >= 1'),

  query('pageSize')
    .optional({ values: 'falsy' })
    .isInt({ min: 1 })
    .withMessage('pageSize must be an integer >= 1'),

  query('orderBy')
    .optional({ values: 'falsy' })
    .isIn(ORDER_ORDER_BY as unknown as string[])
    .withMessage(`orderBy must be one of: ${ORDER_ORDER_BY.join(', ')}`),

  query('orderDir')
    .optional({ values: 'falsy' })
    .isIn(ORDER_DIR as unknown as string[])
    .withMessage('orderDir must be ASC or DESC'),
];

/* ============================================================================
 * By ID (path param) — GET/DELETE /api/orders/:orderId, GET /self/:orderId
 * ==========================================================================*/
/** Validate the `orderId` path param. */
export const vGetOrderById = [
  param('orderId')
    .isString()
    .withMessage('orderId must be a string')
    .bail()
    .notEmpty()
    .withMessage('orderId is required'),
];
export const vGetSelfOrderById = vGetOrderById;
/** DELETE by id uses the same param validation. */
export const vDeleteOrder = vGetOrderById;

/* ============================================================================
 * Field updates — PATCH totals/contact/status/pickup-slot
 * ==========================================================================*/
/**
 * PATCH /:orderId/totals
 * - subtotal, taxTotal, grandTotal are required decimal strings
 * - currency?: 3-letter uppercase code
 */
export const vUpdateOrderTotals = [
  param('orderId')
    .isString()
    .withMessage('orderId must be a string')
    .bail()
    .notEmpty()
    .withMessage('orderId is required'),

  body('subtotal')
    .exists({ checkNull: false })
    .withMessage('subtotal is required')
    .bail()
    .custom(isDecimalString)
    .withMessage('subtotal must be a decimal string'),

  body('taxTotal')
    .exists({ checkNull: false })
    .withMessage('taxTotal is required')
    .bail()
    .custom(isDecimalString)
    .withMessage('taxTotal must be a decimal string'),

  body('grandTotal')
    .exists({ checkNull: false })
    .withMessage('grandTotal is required')
    .bail()
    .custom(isDecimalString)
    .withMessage('grandTotal must be a decimal string'),

  body('currency')
    .optional({ values: 'falsy' })
    .isString()
    .withMessage('currency must be a string')
    .bail()
    .matches(/^[A-Z]{3}$/)
    .withMessage('currency must be a 3-letter uppercase code (e.g., USD)'),
];

/**
 * PATCH /:orderId/contact
 * - contactName?, contactPhone?, notes?: string
 */
export const vUpdateOrderContact = [
  param('orderId')
    .isString()
    .withMessage('orderId must be a string')
    .bail()
    .notEmpty()
    .withMessage('orderId is required'),

  body('contactName')
    .optional({ values: 'falsy' })
    .isString()
    .withMessage('contactName must be a string'),

  body('contactPhone')
    .optional({ values: 'falsy' })
    .isString()
    .withMessage('contactPhone must be a string'),

  body('notes')
    .optional({ values: 'falsy' })
    .isString()
    .withMessage('notes must be a string'),
];

/**
 * PATCH /:orderId/status
 * - status: required, one of ORDER_STATUSES
 */
export const vChangeOrderStatus = [
  param('orderId')
    .isString()
    .withMessage('orderId must be a string')
    .bail()
    .notEmpty()
    .withMessage('orderId is required'),
  body('status')
    .exists({ checkNull: false })
    .withMessage('status is required')
    .bail()
    .isIn(ORDER_STATUSES as unknown as string[])
    .withMessage(`status must be one of: ${ORDER_STATUSES.join(', ')}`),
];

/**
 * PATCH /:orderId/pickup-slot
 * - pickupSlotId: required; string (UUID) or null (to unassign)
 */
export const vSetOrderPickupSlot = [
  param('orderId')
    .isString()
    .withMessage('orderId must be a string')
    .bail()
    .notEmpty()
    .withMessage('orderId is required'),
  body('pickupSlotId')
    .exists()
    .withMessage('pickupSlotId is required (string or null)')
    .bail()
    .custom((v) => v === null || (typeof v === 'string' && v.trim().length > 0))
    .withMessage('pickupSlotId must be a non-empty string or null'),
];
