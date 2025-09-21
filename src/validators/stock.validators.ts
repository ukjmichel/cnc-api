/**
 * =============================================================================
 * Stock Validators — express-validator
 * =============================================================================
 * Covers all endpoints in `src/routes/stock.route.ts`.
 * - Keep rules pragmatic (don’t over-constrain unknown domain fields).
 * - Accept nullable fields where appropriate (e.g., expirationDate, zone).
 * - Validate array-or-string query params for filter endpoints.
 * - Always pair these with your `validationErrorHandler` middleware.
 * =============================================================================
 */

import { body, query } from 'express-validator';

/* --------------------------------- Helpers --------------------------------- */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SORT_RE = /^[A-Za-z0-9_]+:(asc|ASC|desc|DESC)$/;

const isDateOrNull = (v: unknown) =>
  v === null || (typeof v === 'string' && (v === '' || DATE_RE.test(v))); // allow empty string to represent null (per docs)

const isStringArray = (v: unknown) =>
  Array.isArray(v) && v.every((x) => typeof x === 'string');

const arrayOrString =
  (allowNullKeyword = false, allowEmpty = false) =>
  (v: unknown) => {
    const validString = (s: unknown) =>
      typeof s === 'string' &&
      (allowEmpty || s.trim().length > 0) &&
      (!allowNullKeyword || s.toLowerCase() === 'null' || !!s);
    if (typeof v === 'string') return validString(v);
    if (Array.isArray(v)) return v.every(validString);
    return false;
  };

const lotKey = (prefix: string) => [
  body(`${prefix}.productId`)
    .exists()
    .withMessage(`${prefix}.productId is required`)
    .bail()
    .isString()
    .withMessage(`${prefix}.productId must be a string`)
    .trim()
    .notEmpty()
    .withMessage(`${prefix}.productId cannot be empty`),
  body(`${prefix}.location`)
    .exists()
    .withMessage(`${prefix}.location is required`)
    .bail()
    .isString()
    .withMessage(`${prefix}.location must be a string`)
    .trim()
    .notEmpty()
    .withMessage(`${prefix}.location cannot be empty`),
  body(`${prefix}.zone`)
    .optional({ nullable: true })
    .isString()
    .withMessage(`${prefix}.zone must be a string`)
    .trim(),
  body(`${prefix}.expirationDate`)
    .optional({ nullable: true })
    .custom(isDateOrNull)
    .withMessage(`${prefix}.expirationDate must be YYYY-MM-DD or null/empty`),
];

/* --------------------------------- Adjust ---------------------------------- */

/** POST /api/stocks/adjust */
export const vAdjustStock = [
  // LotKey (flattened in body)
  body('productId')
    .exists()
    .withMessage('productId is required')
    .bail()
    .isString()
    .withMessage('productId must be a string')
    .trim()
    .notEmpty()
    .withMessage('productId cannot be empty'),
  body('location')
    .exists()
    .withMessage('location is required')
    .bail()
    .isString()
    .withMessage('location must be a string')
    .trim()
    .notEmpty()
    .withMessage('location cannot be empty'),
  body('zone')
    .optional({ nullable: true })
    .isString()
    .withMessage('zone must be a string')
    .trim(),
  body('expirationDate')
    .optional({ nullable: true })
    .custom(isDateOrNull)
    .withMessage('expirationDate must be YYYY-MM-DD or null/empty'),

  // Adjust fields
  body('quantityDelta')
    .exists()
    .withMessage('quantityDelta is required')
    .bail()
    .isFloat()
    .withMessage('quantityDelta must be a number')
    .toFloat()
    .custom((v) => v !== 0)
    .withMessage('quantityDelta must be non-zero'),
  body('unitPrice')
    .optional({ nullable: true })
    .isFloat()
    .withMessage('unitPrice must be a number')
    .toFloat(),
  body('reason')
    .optional()
    .isIn(['in', 'out', 'adjustment', 'transfer_in', 'transfer_out'])
    .withMessage(
      'reason must be one of: in, out, adjustment, transfer_in, transfer_out'
    ),
  body('reference')
    .optional({ nullable: true })
    .isString()
    .withMessage('reference must be a string')
    .trim(),
  body('allowNegative')
    .optional()
    .isBoolean()
    .withMessage('allowNegative must be boolean')
    .toBoolean(),
  body('updateAveragePriceOnInbound')
    .optional()
    .isBoolean()
    .withMessage('updateAveragePriceOnInbound must be boolean')
    .toBoolean(),
  body('performedAt')
    .optional()
    .isISO8601()
    .withMessage('performedAt must be an ISO date-time'),
];

/* -------------------------------- Transfer --------------------------------- */

/** POST /api/stocks/transfer */
export const vTransferStock = [
  ...lotKey('from'),
  ...lotKey('to'),
  body('quantity')
    .exists()
    .withMessage('quantity is required')
    .bail()
    .isFloat({ gt: 0 })
    .withMessage('quantity must be a number > 0')
    .toFloat(),
  body('unitPrice')
    .optional({ nullable: true })
    .isFloat()
    .withMessage('unitPrice must be a number')
    .toFloat(),
  body('reference')
    .optional({ nullable: true })
    .isString()
    .withMessage('reference must be a string')
    .trim(),
  body('allowNegative')
    .optional()
    .isBoolean()
    .withMessage('allowNegative must be boolean')
    .toBoolean(),
  body('updateAveragePriceOnInbound')
    .optional()
    .isBoolean()
    .withMessage('updateAveragePriceOnInbound must be boolean')
    .toBoolean(),
  body('performedAt')
    .optional()
    .isISO8601()
    .withMessage('performedAt must be an ISO date-time'),
];

/* -------------------------------- On-hand ---------------------------------- */

/** GET /api/stocks/on-hand */
export const vGetOnHand = [
  query('productId')
    .exists()
    .withMessage('productId is required')
    .bail()
    .isString()
    .trim()
    .notEmpty(),
  query('location')
    .exists()
    .withMessage('location is required')
    .bail()
    .isString()
    .trim()
    .notEmpty(),
  query('zone')
    .optional({ nullable: true })
    .isString()
    .withMessage('zone must be a string')
    .trim(),
  query('expirationDate')
    .optional({ nullable: true })
    .custom(isDateOrNull)
    .withMessage('expirationDate must be YYYY-MM-DD or null/empty'),
];

/* --------------------------------- Filter ---------------------------------- */

/** GET /api/stocks/filter */
export const vFilterStocks = [
  query('q').optional().isString().withMessage('q must be a string').trim(),

  // Structured filters (either string or array of strings; allow "null")
  query('productId')
    .optional()
    .custom(arrayOrString(false))
    .withMessage('productId must be a string or array of strings'),
  query('location')
    .optional()
    .custom(arrayOrString(false))
    .withMessage('location must be a string or array of strings'),
  query('zone')
    .optional()
    .custom(arrayOrString(true, true))
    .withMessage('zone must be a string/array or "null"'),
  query('expirationDate')
    .optional()
    .custom(arrayOrString(true, true))
    .withMessage('expirationDate must be YYYY-MM-DD / array / "null"'),

  // Ranges
  query('quantityFrom')
    .optional()
    .isFloat()
    .withMessage('quantityFrom must be a number')
    .toFloat(),
  query('quantityTo')
    .optional()
    .isFloat()
    .withMessage('quantityTo must be a number')
    .toFloat(),
  query('unitPriceFrom')
    .optional()
    .isFloat()
    .withMessage('unitPriceFrom must be a number')
    .toFloat(),
  query('unitPriceTo')
    .optional()
    .isFloat()
    .withMessage('unitPriceTo must be a number')
    .toFloat(),

  // Date ranges
  query('createdAtFrom')
    .optional()
    .isISO8601()
    .withMessage('createdAtFrom must be ISO date-time'),
  query('createdAtTo')
    .optional()
    .isISO8601()
    .withMessage('createdAtTo must be ISO date-time'),
  query('updatedAtFrom')
    .optional()
    .isISO8601()
    .withMessage('updatedAtFrom must be ISO date-time'),
  query('updatedAtTo')
    .optional()
    .isISO8601()
    .withMessage('updatedAtTo must be ISO date-time'),

  // Paging & sort
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('page must be ≥ 1')
    .toInt(),
  query('pageSize')
    .optional()
    .isInt({ min: 1 })
    .withMessage('pageSize must be ≥ 1')
    .toInt(),
  query('sort')
    .optional()
    .custom((v) => typeof v === 'string' && SORT_RE.test(v))
    .withMessage('sort must be "field:asc|desc"'),
];

/* ---------------------------------- List ----------------------------------- */

/** GET /api/stocks */
export const vListStocks = [
  query('q').optional().isString().withMessage('q must be a string').trim(),
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('page must be ≥ 1')
    .toInt(),
  query('pageSize')
    .optional()
    .isInt({ min: 1 })
    .withMessage('pageSize must be ≥ 1')
    .toInt(),
  query('sort')
    .optional()
    .custom((v) => typeof v === 'string' && SORT_RE.test(v))
    .withMessage('sort must be "field:asc|desc"'),
];

/* ----------------------------- Lots of product ----------------------------- */

/** GET /api/stocks/lots-of-product */
export const vLotsOfProduct = [
  query('productId')
    .exists()
    .withMessage('productId is required')
    .bail()
    .isString()
    .trim()
    .notEmpty(),
];

/* --------------------------------- Rebuild --------------------------------- */

/** POST /api/stocks/rebuild */
export const vRebuildLot = [
  body('productId')
    .exists()
    .withMessage('productId is required')
    .bail()
    .isString()
    .withMessage('productId must be a string')
    .trim()
    .notEmpty(),
  body('location')
    .exists()
    .withMessage('location is required')
    .bail()
    .isString()
    .withMessage('location must be a string')
    .trim()
    .notEmpty(),
  body('zone')
    .optional({ nullable: true })
    .isString()
    .withMessage('zone must be a string')
    .trim(),
  body('expirationDate')
    .optional({ nullable: true })
    .custom(isDateOrNull)
    .withMessage('expirationDate must be YYYY-MM-DD or null/empty'),
];
