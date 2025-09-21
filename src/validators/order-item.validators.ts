// src/validators/order-item.validators.ts
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

/** Decimal string helpers */
const isDec = (digits: number) => (value: unknown) =>
  typeof value === 'string' &&
  new RegExp(`^-?\\d+(\\.\\d{1,${digits}})?$`).test(value);

/** POST / (single create) */
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

/** POST /bulk (array create/merge) */
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

/** GET / (list for order) with pagination/sort */
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

/** PATCH /:stockId (update) */
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

/** GET /api/order-items (global filter) */
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
