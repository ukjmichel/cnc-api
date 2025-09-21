// src/validators/order-item.validators.ts

/**
 * =============================================================================
 * Order Item Validators — express-validator chains for order items
 * =============================================================================
 * Scope
 *  - Nested under orders:        /api/orders/:orderId/items
 *  - Global listing/filtering:   /api/order-items
 *
 * Conventions
 *  - Quantities are decimal **strings** with up to 3 decimals (e.g., "1.250")
 *  - Money fields (unitPrice, lineTotal) are decimal **strings** with up to 2 decimals
 *  - All IDs are UUID v4 strings
 *
 * Usage
 *  - Attach these arrays before your controller and follow with your `validate`
 *    middleware that collects `validationResult(req)` and formats a 400 response.
 *    Example:
 *      router.post('/:orderId/items', vCreateOrderItem, validate, ctrl.create)
 *
 * Notes
 *  - Designed for express-validator v7+ (uses `path` not `param` in results).
 *  - Does not transform values except for numeric checks; controllers can cast.
 * =============================================================================
 */

import { body, param, query } from 'express-validator';

/** Common: UUID param for orderId (path param on nested router) */
export const vOrderIdParam = [
  param('orderId')
    .exists()
    .withMessage('orderId param required')
    .bail()
    .isUUID()
    .withMessage('orderId must be a valid UUID'),
];

/** Common: UUID param for stockId */
export const vStockIdParam = [
  param('stockId')
    .exists()
    .withMessage('stockId param required')
    .bail()
    .isUUID()
    .withMessage('stockId must be a valid UUID'),
];

/**
 * Predicate factory for validating fixed-precision decimal strings.
 * @param digits - Maximum number of decimal places allowed.
 * @returns A custom validator that checks a string like "123.45".
 */
const isDec = (digits: number) => (value: unknown) =>
  typeof value === 'string' &&
  new RegExp(`^-?\\d+(\\.\\d{1,${digits}})?$`).test(value);

/**
 * POST /api/orders/:orderId/items
 * Validate single item creation payload.
 * Fields:
 *  - stockId   (UUID, required)
 *  - quantity  (decimal string, <= 3 dp, required)
 *  - unitPrice (decimal string, <= 2 dp, optional)
 *  - lineTotal (decimal string, <= 2 dp, optional)
 */
export const vCreateOrderItem = [
  ...vOrderIdParam,
  body('stockId')
    .exists()
    .withMessage('stockId is required')
    .bail()
    .isUUID()
    .withMessage('stockId must be a valid UUID'),
  body('quantity')
    .exists()
    .withMessage('quantity is required')
    .bail()
    .custom(isDec(3))
    .withMessage('quantity must be a decimal string with up to 3 decimals'),
  body('unitPrice')
    .optional()
    .custom(isDec(2))
    .withMessage('unitPrice must be a decimal string with up to 2 decimals'),
  body('lineTotal')
    .optional()
    .custom(isDec(2))
    .withMessage('lineTotal must be a decimal string with up to 2 decimals'),
];

/**
 * POST /api/orders/:orderId/items/bulk
 * Validate bulk create/merge array payload.
 * Each element requires:
 *  - stockId   (UUID, required)
 *  - quantity  (decimal string, <= 3 dp, required)
 *  - unitPrice (decimal string, <= 2 dp, optional)
 *  - lineTotal (decimal string, <= 2 dp, optional)
 */
export const vCreateManyOrderItems = [
  ...vOrderIdParam,
  body()
    .isArray({ min: 1 })
    .withMessage('Body must be a non-empty array of items'),
  body('*.stockId')
    .exists()
    .withMessage('stockId is required')
    .bail()
    .isUUID()
    .withMessage('stockId must be a valid UUID'),
  body('*.quantity')
    .exists()
    .withMessage('quantity is required')
    .bail()
    .custom(isDec(3))
    .withMessage('quantity must be a decimal string with up to 3 decimals'),
  body('*.unitPrice')
    .optional()
    .custom(isDec(2))
    .withMessage('unitPrice must be a decimal string with up to 2 decimals'),
  body('*.lineTotal')
    .optional()
    .custom(isDec(2))
    .withMessage('lineTotal must be a decimal string with up to 2 decimals'),
];

/**
 * GET /api/orders/:orderId/items
 * Validate pagination/sort query for listing items under an order.
 */
export const vListForOrder = [
  ...vOrderIdParam,
  query('page').optional().isInt({ min: 1 }).withMessage('page must be >= 1'),
  query('pageSize')
    .optional()
    .isInt({ min: 1, max: 200 })
    .withMessage('pageSize must be 1..200'),
  query('orderBy')
    .optional()
    .isIn(['createdAt', 'updatedAt', 'quantity', 'unitPrice', 'lineTotal'])
    .withMessage('orderBy is invalid'),
  query('orderDir')
    .optional()
    .isIn(['ASC', 'DESC', 'asc', 'desc'])
    .withMessage('orderDir must be ASC or DESC'),
];

/** GET /:stockId (get one) */
export const vGetOne = [...vOrderIdParam, ...vStockIdParam];

/**
 * PATCH /api/orders/:orderId/items/:stockId
 * Validate updatable fields on an order item.
 * - quantity  (decimal string, <= 3 dp)
 * - unitPrice (decimal string, <= 2 dp)
 */
export const vUpdateOrderItem = [
  ...vOrderIdParam,
  ...vStockIdParam,
  body('quantity')
    .optional()
    .custom(isDec(3))
    .withMessage('quantity must be a decimal string with up to 3 decimals'),
  body('unitPrice')
    .optional()
    .custom(isDec(2))
    .withMessage('unitPrice must be a decimal string with up to 2 decimals'),
];

/** DELETE /:stockId (remove) */
export const vRemoveOrderItem = [...vOrderIdParam, ...vStockIdParam];

/**
 * GET /api/order-items
 * Validate global filter for order items across all orders.
 * Supports:
 *  - orderId, stockId (UUID)
 *  - productId (string)
 *  - createdFrom / createdTo (ISO dates)
 *  - numeric ranges: quantityMin/Max, unitPriceMin/Max, lineTotalMin/Max
 *  - pagination/sort: page, pageSize, orderBy, orderDir
 */
export const vGlobalFilter = [
  query('page').optional().isInt({ min: 1 }).withMessage('page must be >= 1'),
  query('pageSize')
    .optional()
    .isInt({ min: 1, max: 200 })
    .withMessage('pageSize must be 1..200'),
  query('orderBy')
    .optional()
    .isIn(['createdAt', 'updatedAt', 'quantity', 'unitPrice', 'lineTotal'])
    .withMessage('orderBy is invalid'),
  query('orderDir')
    .optional()
    .isIn(['ASC', 'DESC', 'asc', 'desc'])
    .withMessage('orderDir must be ASC or DESC'),

  query('orderId').optional().isUUID().withMessage('orderId must be UUID'),
  query('stockId').optional().isUUID().withMessage('stockId must be UUID'),
  query('productId')
    .optional()
    .isString()
    .isLength({ min: 1 })
    .withMessage('productId must be non-empty'),

  query('createdFrom')
    .optional()
    .isISO8601()
    .withMessage('createdFrom must be ISO date'),
  query('createdTo')
    .optional()
    .isISO8601()
    .withMessage('createdTo must be ISO date'),

  query('quantityMin')
    .optional()
    .isFloat()
    .withMessage('quantityMin must be a number'),
  query('quantityMax')
    .optional()
    .isFloat()
    .withMessage('quantityMax must be a number'),
  query('unitPriceMin')
    .optional()
    .isFloat()
    .withMessage('unitPriceMin must be a number'),
  query('unitPriceMax')
    .optional()
    .isFloat()
    .withMessage('unitPriceMax must be a number'),
  query('lineTotalMin')
    .optional()
    .isFloat()
    .withMessage('lineTotalMin must be a number'),
  query('lineTotalMax')
    .optional()
    .isFloat()
    .withMessage('lineTotalMax must be a number'),
];
